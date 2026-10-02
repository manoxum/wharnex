package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"strings"

	"kernl.local/harness/backend/internal/uitesting"
)

type discoveryInput struct {
	ContextSHA256 string                  `json:"context_sha256"`
	Environments  []uitesting.Environment `json:"environments"`
	Tests         []uitesting.TestCase    `json:"tests"`
}
type credentialInput struct {
	RunID         string `json:"run_id"`
	EnvironmentID string `json:"environment_id"`
	ProfileID     string `json:"profile_id"`
}
type resultInput struct {
	RunID  string              `json:"run_id"`
	Result uitesting.RunResult `json:"result"`
}

func (h *Routes) discovery(w http.ResponseWriter, r *http.Request) {
	task, err := h.sessions.GetChatAgentTask(r.PathValue("id"))
	if err != nil || task.Type != "UI_TEST_DISCOVER" {
		writeErr(w, 404, errors.New("UI discovery task not found"))
		return
	}
	var input discoveryInput
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<20)).Decode(&input) != nil {
		writeErr(w, 400, errors.New("invalid UI discovery result"))
		return
	}
	if strings.TrimSpace(input.ContextSHA256) == "" {
		writeErr(w, 400, errors.New("context_sha256 is required"))
		return
	}
	previous, _ := h.store.Load(task.ProjectID)
	doc, err := h.store.SaveDiscovery(task.ProjectID, uitesting.Discovery{ContextSHA256: input.ContextSHA256, Environments: input.Environments, Tests: input.Tests})
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	if previous.ContextSHA256 != "" && previous.ContextSHA256 != doc.ContextSHA256 && doc.AutoRunChanges {
		for _, test := range doc.Tests {
			_, _ = h.enqueueRun(task.SessionID, task.ProjectID, test, doc)
		}
	}
	writeJSON(w, 200, doc)
}

func (h *Routes) credential(w http.ResponseWriter, r *http.Request) {
	task, err := h.sessions.GetChatAgentTask(r.PathValue("id"))
	if err != nil || task.Type != "UI_TEST_RUN" {
		writeErr(w, 404, errors.New("UI test task not found"))
		return
	}
	var input credentialInput
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&input) != nil {
		writeErr(w, 400, errors.New("invalid credential request"))
		return
	}
	var payload struct {
		RunID       string `json:"run_id"`
		Environment struct {
			ID string `json:"id"`
		} `json:"environment"`
		Profile struct {
			ID string `json:"id"`
		} `json:"profile"`
	}
	if json.Unmarshal(task.Payload, &payload) != nil || payload.RunID != input.RunID || payload.Environment.ID != input.EnvironmentID || payload.Profile.ID != input.ProfileID {
		writeErr(w, 403, errors.New("credential request does not match this run target"))
		return
	}
	if input.ProfileID == "" {
		writeJSON(w, 200, uitesting.Credentials{})
		return
	}
	credentials, err := h.store.Credentials(task.ProjectID, input.EnvironmentID, input.ProfileID)
	if err != nil {
		writeErr(w, 409, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, 200, credentials)
}

func (h *Routes) result(w http.ResponseWriter, r *http.Request) {
	task, err := h.sessions.GetChatAgentTask(r.PathValue("id"))
	if err != nil || task.Type != "UI_TEST_RUN" {
		writeErr(w, 404, errors.New("UI test task not found"))
		return
	}
	var input resultInput
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<20)).Decode(&input) != nil {
		writeErr(w, 400, errors.New("invalid UI test result"))
		return
	}
	var payload struct {
		RunID string `json:"run_id"`
	}
	if json.Unmarshal(task.Payload, &payload) != nil || payload.RunID != input.RunID {
		writeErr(w, 403, errors.New("result does not match this run"))
		return
	}
	doc, err := h.store.CompleteRun(task.ProjectID, input.RunID, input.Result)
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	writeJSON(w, 200, doc)
}

func (h *Routes) asset(w http.ResponseWriter, r *http.Request) {
	item, err := h.sessions.Get(r.PathValue("id"))
	if err != nil {
		writeErr(w, 404, err)
		return
	}
	path, err := h.store.AssetPath(item.ProjectPath, r.PathValue("run"), r.PathValue("name"))
	if err != nil {
		writeErr(w, 404, err)
		return
	}
	if strings.HasSuffix(path, ".pdf") {
		w.Header().Set("Content-Type", "application/pdf")
	} else if strings.HasSuffix(path, ".md") {
		w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
	} else {
		w.Header().Set("Content-Type", "image/png")
	}
	w.Header().Set("Cache-Control", "private, max-age=300")
	file, err := os.Open(path)
	if err != nil {
		writeErr(w, 404, err)
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		writeErr(w, 404, err)
		return
	}
	http.ServeContent(w, r, r.PathValue("name"), info.ModTime(), file)
}
