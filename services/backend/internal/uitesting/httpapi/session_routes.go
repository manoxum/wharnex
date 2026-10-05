package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"kernl.local/harness/backend/internal/session"
	"kernl.local/harness/backend/internal/uitesting"
	"kernl.local/harness/backend/internal/uitesting/sessionvault"
)

type sessionInput struct {
	RunID  string          `json:"run_id"`
	TestID string          `json:"test_id,omitempty"`
	State  json.RawMessage `json:"state,omitempty"`
}

// saveBrowserSession seals and persists the browser state a passed test left
// behind. It covers that test and every earlier test of its chain.
func (h *Routes) saveBrowserSession(w http.ResponseWriter, r *http.Request) {
	task, payload, input, ok := h.runTaskRequest(w, r, 2<<20)
	if !ok {
		return
	}
	item, index, found := payload.chainRun(input.RunID)
	doc, err := h.store.Load(task.ProjectID)
	if !found || len(payload.FullChain) == 0 || err != nil || runStatus(doc, input.RunID) != "passed" {
		writeErr(w, 409, errors.New("only a passed run of this task may save its session"))
		return
	}
	origin, err := environmentOrigin(payload.Environment.URL)
	if err != nil {
		writeErr(w, 409, err)
		return
	}
	_, canonical, err := sessionvault.DecodeState(input.State, origin)
	if err != nil {
		writeErr(w, 400, err)
		return
	}
	sealed, err := h.store.SealSecret(canonical)
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	graph, err := uitesting.CatalogGraph(doc.Tests)
	if err != nil {
		writeErr(w, 409, err)
		return
	}
	profile, _ := graph.EffectiveProfile(item.Test.ID)
	digests := currentDigests(doc)
	snapshot := sessionvault.Snapshot{Project: task.ProjectID, EnvironmentID: payload.Environment.ID, TestID: item.Test.ID, ProfileID: profile,
		Origin: origin, Digests: map[string]string{}, Sealed: sealed, CapturedAt: time.Now().UTC()}
	snapshot.ExpiresAt = snapshot.CapturedAt.Add(sessionvault.TTL)
	for _, covered := range payload.FullChain[:index+1] {
		snapshot.Covers = append(snapshot.Covers, covered.Test.ID)
		snapshot.Digests[covered.Test.ID] = digests[covered.Test.ID]
	}
	if _, err := h.vault.Save(r.Context(), snapshot); err != nil {
		writeErr(w, 500, err)
		return
	}
	_ = h.vault.Prune(r.Context(), time.Now().UTC())
	writeJSON(w, 200, map[string]any{"saved": true, "covers": snapshot.Covers})
}

// restoreBrowserSession returns the sealed state the plan chose, after proving
// it still stands for the prerequisites it replaces. A stale session answers
// 409 so the worker runs the full chain instead.
func (h *Routes) restoreBrowserSession(w http.ResponseWriter, r *http.Request) {
	task, payload, input, ok := h.runTaskRequest(w, r, 64<<10)
	if !ok {
		return
	}
	if _, _, found := payload.chainRun(input.RunID); !found || payload.Restore == nil {
		writeErr(w, 403, errors.New("this run has no session to restore"))
		return
	}
	snapshot, err := h.vault.Get(r.Context(), task.ProjectID, payload.Restore.SessionID)
	doc, loadErr := h.store.Load(task.ProjectID)
	origin, originErr := environmentOrigin(payload.Environment.URL)
	if err != nil || loadErr != nil || originErr != nil || !h.stillReusable(snapshot, doc, payload, origin) {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "persisted session is no longer valid", "code": "session_invalid"})
		return
	}
	plain, err := h.store.OpenSecret(snapshot.Sealed)
	if err != nil {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "persisted session cannot be decrypted", "code": "session_invalid"})
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, 200, map[string]any{"test_id": snapshot.TestID, "state": json.RawMessage(plain)})
}

func (h *Routes) stillReusable(snapshot sessionvault.Snapshot, doc uitesting.Document, payload runPayload, origin string) bool {
	graph, err := uitesting.CatalogGraph(doc.Tests)
	if err != nil {
		return false
	}
	prefix := []string{}
	for _, item := range payload.FullChain {
		prefix = append(prefix, item.Test.ID)
		if item.Test.ID == payload.Restore.TestID {
			break
		}
	}
	profiles := map[string]string{}
	for _, id := range prefix {
		profiles[id], _ = graph.EffectiveProfile(id)
	}
	return sessionvault.Reusable(snapshot, sessionvault.PlanInput{EnvironmentID: payload.Environment.ID, Origin: origin,
		Profiles: profiles, Digests: currentDigests(doc), Now: time.Now().UTC()}, prefix)
}

// invalidateBrowserSession drops a session the executor found signed out.
func (h *Routes) invalidateBrowserSession(w http.ResponseWriter, r *http.Request) {
	task, payload, input, ok := h.runTaskRequest(w, r, 64<<10)
	if !ok {
		return
	}
	if _, _, found := payload.chainRun(input.RunID); !found || payload.Restore == nil || input.TestID != payload.Restore.TestID {
		writeErr(w, 403, errors.New("session invalidation does not match this run"))
		return
	}
	removed, err := h.vault.Delete(r.Context(), task.ProjectID, sessionvault.Filter{EnvironmentID: payload.Environment.ID, TestID: input.TestID})
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	writeJSON(w, 200, map[string]int{"removed": removed})
}

// runTaskRequest loads a UI_TEST_RUN task, its payload and a bounded body.
func (h *Routes) runTaskRequest(w http.ResponseWriter, r *http.Request, limit int64) (session.ChatAgentTask, runPayload, sessionInput, bool) {
	var payload runPayload
	var input sessionInput
	task, err := h.sessions.GetChatAgentTask(r.PathValue("id"))
	if err != nil || task.Type != "UI_TEST_RUN" {
		writeErr(w, 404, errors.New("UI test task not found"))
		return task, payload, input, false
	}
	if json.Unmarshal(task.Payload, &payload) != nil || json.NewDecoder(http.MaxBytesReader(w, r.Body, limit)).Decode(&input) != nil {
		writeErr(w, 400, errors.New("invalid UI test session request"))
		return task, payload, input, false
	}
	return task, payload, input, true
}

func currentDigests(doc uitesting.Document) map[string]string {
	digests := map[string]string{}
	for _, test := range doc.Tests {
		digests[test.ID] = uitesting.DefinitionDigest(test)
	}
	return digests
}

func runStatus(doc uitesting.Document, runID string) string {
	for _, run := range doc.Runs {
		if run.ID == runID {
			return run.Status
		}
	}
	return ""
}
