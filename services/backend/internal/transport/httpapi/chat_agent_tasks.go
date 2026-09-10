package httpapi

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/session"
)

type chatAgentLeaseRequest struct {
	Owner        string `json:"owner"`
	LeaseSeconds int    `json:"lease_seconds"`
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
	items, err := a.store.ListChatAgentTasks(session.ChatAgentTaskFilter{
		ChatID: r.URL.Query().Get("chat_id"), RequestID: r.URL.Query().Get("request_id"),
		Status: r.URL.Query().Get("status"), Limit: limit,
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

func (a *API) claimChatAgentTask(w http.ResponseWriter, r *http.Request) {
	var body chatAgentLeaseRequest
	if !decodeJSON(w, r, &body) {
		return
	}
	lease := time.Duration(body.LeaseSeconds) * time.Second
	if lease == 0 {
		lease = 45 * time.Second
	}
	task, err := a.store.ClaimChatAgentTask(body.Owner, lease)
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
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	task, err := a.store.WaitChatAgentTask(r.PathValue("id"), body.Owner, body.NotBefore, body.Error)
	if err != nil {
		writeChatAgentTaskError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, task)
}

func (a *API) completeChatAgentTask(w http.ResponseWriter, r *http.Request) {
	a.chatAgentSimpleTransition(w, r, func(id, owner string) (session.ChatAgentTask, error) {
		return a.store.CompleteChatAgentTask(id, owner)
	})
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
