package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/session"
)

type chatAgentLeaseRequest struct {
	Owner         string   `json:"owner"`
	LeaseSeconds  int      `json:"lease_seconds"`
	PreferredLane string   `json:"preferred_lane"`
	ExcludedLanes []string `json:"excluded_lanes"`
	FallbackMode  string   `json:"fallback_mode"`
}

func (a *API) enqueueChatAgentTask(w http.ResponseWriter, r *http.Request) {
	var task session.ChatAgentTask
	if !decodeJSON(w, r, &task) {
		return
	}
	saved, err := a.store.EnqueueChatAgentTask(task)
	if err != nil {
		writeChatAgentTaskError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, saved)
}

func (a *API) listChatAgentTasks(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	active := strings.TrimSpace(r.URL.Query().Get("active"))
	items, err := a.store.ListChatAgentTasks(session.ChatAgentTaskFilter{
		ChatID: r.URL.Query().Get("chat_id"), RequestID: r.URL.Query().Get("request_id"),
		Status: r.URL.Query().Get("status"), ActiveOnly: active == "1" || strings.EqualFold(active, "true"), Limit: limit,
	})
	if err != nil {
		writeChatAgentTaskError(w, err)
		return
	}
	if items == nil {
		items = []session.ChatAgentTask{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"tasks": items})
}

// chatAgentTaskSummary reports queue depth as an aggregate.
//
// The runtime view used to derive its counters by listing tasks and counting
// them in the client, which silently stops being true once the table outgrows
// the list window: that window is ordered oldest-first, so it fills with
// completed history and hides the live queue. Counting in the store is exact
// regardless of table size.
func (a *API) chatAgentTaskSummary(w http.ResponseWriter, r *http.Request) {
	summary, err := a.store.ChatAgentQueueSummary()
	if err != nil {
		writeChatAgentTaskError(w, err)
		return
	}
	if summary.Counts == nil {
		summary.Counts = map[string]int{}
	}
	writeJSON(w, http.StatusOK, summary)
}

func (a *API) claimChatAgentTask(w http.ResponseWriter, r *http.Request) {
	var body chatAgentLeaseRequest
	if !decodeJSON(w, r, &body) {
		return
	}
	lease := time.Duration(body.LeaseSeconds) * time.Second
	if lease == 0 {
		lease = 45 * time.Second
	}
	task, err := a.store.ClaimChatAgentTaskWithOptions(body.Owner, lease, session.ChatAgentClaimOptions{
		PreferredLane: body.PreferredLane, ExcludedLanes: body.ExcludedLanes, FallbackMode: body.FallbackMode,
	})
	if err != nil {
		writeChatAgentTaskError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"task": task})
}

func (a *API) startChatAgentTask(w http.ResponseWriter, r *http.Request) {
	a.chatAgentSimpleTransition(w, r, func(id, owner string) (session.ChatAgentTask, error) {
		return a.store.StartChatAgentTask(id, owner)
	})
}

func (a *API) heartbeatChatAgentTask(w http.ResponseWriter, r *http.Request) {
	var body chatAgentLeaseRequest
	if !decodeJSON(w, r, &body) {
		return
	}
	lease := time.Duration(body.LeaseSeconds) * time.Second
	if lease == 0 {
		lease = 45 * time.Second
	}
	task, err := a.store.HeartbeatChatAgentTask(r.PathValue("id"), body.Owner, lease)
	if err != nil {
		writeChatAgentTaskError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, task)
}

func (a *API) waitChatAgentTask(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Owner     string    `json:"owner"`
		NotBefore time.Time `json:"not_before"`
		Error     string    `json:"error"`
		// Observation marks a lease that only watched healthy remote progress.
		// It returns the attempt the claim charged, so supervising a long but
		// healthy response cannot exhaust the budget meant for real attempts.
		Observation bool `json:"observation"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	task, err := a.store.WaitChatAgentTask(r.PathValue("id"), body.Owner, body.NotBefore, body.Error, body.Observation)
	if err != nil {
		writeChatAgentTaskError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, task)
}

func (a *API) completeChatAgentTask(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 64<<20)
	var body struct {
		Owner   string          `json:"owner"`
		Payload json.RawMessage `json:"payload"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	var (
		task session.ChatAgentTask
		err  error
	)
	if len(body.Payload) > 0 && string(body.Payload) != "null" {
		task, err = a.store.CompleteChatAgentTaskWithPayload(r.PathValue("id"), body.Owner, body.Payload)
	} else {
		task, err = a.store.CompleteChatAgentTask(r.PathValue("id"), body.Owner)
	}
	if err != nil {
		writeChatAgentTaskError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, task)
}

func (a *API) failChatAgentTask(w http.ResponseWriter, r *http.Request) {
	a.finishChatAgentTask(w, r, false)
}

func (a *API) attentionChatAgentTask(w http.ResponseWriter, r *http.Request) {
	a.finishChatAgentTask(w, r, true)
}

func (a *API) finishChatAgentTask(w http.ResponseWriter, r *http.Request, attention bool) {
	var body struct {
		Owner string `json:"owner"`
		Error string `json:"error"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	task, err := a.store.FailChatAgentTask(r.PathValue("id"), body.Owner, body.Error, attention)
	if err != nil {
		writeChatAgentTaskError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, task)
}

func (a *API) chatAgentSimpleTransition(
	w http.ResponseWriter,
	r *http.Request,
	run func(string, string) (session.ChatAgentTask, error),
) {
	var body struct {
		Owner string `json:"owner"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	task, err := run(r.PathValue("id"), body.Owner)
	if err != nil {
		writeChatAgentTaskError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, task)
}

func (a *API) cancelChatAgentLineage(w http.ResponseWriter, r *http.Request) {
	var body struct {
		RootRequestID string `json:"root_request_id"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	count, err := a.store.CancelChatAgentLineage(body.RootRequestID)
	if err != nil {
		writeChatAgentTaskError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "cancelled": count})
}

func (a *API) chatAgentProviderState(w http.ResponseWriter, _ *http.Request) {
	state, err := a.store.ChatAgentProviderState()
	if err != nil {
		writeChatAgentTaskError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, state)
}

func (a *API) updateChatAgentProviderState(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Paused      bool       `json:"paused"`
		PausedUntil *time.Time `json:"paused_until"`
		Reason      string     `json:"reason"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	state, err := a.store.SetChatAgentProviderPause(body.Paused, body.PausedUntil, body.Reason)
	if err != nil {
		writeChatAgentTaskError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, state)
}

func (a *API) recordChatAgentRateLimit(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Source string `json:"source"`
		Kind   string `json:"kind"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	state, err := a.store.RecordChatAgentRateLimit(body.Source, body.Kind)
	if err != nil {
		writeChatAgentTaskError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, state)
}

func (a *API) recordChatAgentValidBundle(w http.ResponseWriter, r *http.Request) {
	var body struct {
		RequestID      string `json:"request_id"`
		ConversationID string `json:"conversation_id"`
		DurationMS     int64  `json:"duration_ms"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	state, err := a.store.RecordChatAgentValidBundle(
		body.RequestID, body.ConversationID, time.Duration(body.DurationMS)*time.Millisecond,
	)
	if err != nil {
		writeChatAgentTaskError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, state)
}

func writeChatAgentTaskError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, session.ErrChatAgentTaskNotFound):
		writeError(w, http.StatusNotFound, "chat_agent_task_not_found", err.Error())
	case errors.Is(err, session.ErrChatAgentLeaseOwner):
		writeError(w, http.StatusConflict, "chat_agent_lease_conflict", err.Error())
	case strings.Contains(err.Error(), "required"), strings.Contains(err.Error(), "unsupported"),
		strings.Contains(err.Error(), "must be"):
		writeError(w, http.StatusBadRequest, "invalid_chat_agent_task", err.Error())
	default:
		writeError(w, http.StatusInternalServerError, "chat_agent_task_failed", err.Error())
	}
}
