package httpapi

import (
	"net/http"
	"strings"

	"kernl.local/harness/backend/internal/domain"
)

func (a *API) openInteractiveTerminal(w http.ResponseWriter, r *http.Request) {
	target := domain.TerminalTarget(strings.TrimSpace(r.URL.Query().Get("target")))
	if target == "" {
		target = domain.TerminalTargetSandbox
	}
	if !domain.ValidTerminalTarget(target) {
		writeError(w, http.StatusBadRequest, "invalid_terminal_target", "terminal target must be sandbox or host")
		return
	}
	if target == domain.TerminalTargetHost && r.URL.Query().Get("confirm_host") != "true" {
		writeError(w, http.StatusConflict, "host_terminal_confirmation_required", "host terminal requires explicit confirmation")
		return
	}
	var body struct {
		TerminalID string `json:"terminal_id"`
		Cwd        string `json:"cwd"`
		Network    bool   `json:"network"`
		Cols       int    `json:"cols"`
		Rows       int    `json:"rows"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	descriptor, err := a.service.StartOrReconnectInteractiveTerminal(r.Context(), r.PathValue("id"), body.TerminalID, target, body.Cwd, body.Network, body.Cols, body.Rows)
	if err != nil {
		writeError(w, http.StatusBadRequest, "terminal_open_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, descriptor)
}

func (a *API) interactiveTerminalInput(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Data string `json:"data"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if err := a.service.WriteInteractiveTerminal(r.PathValue("id"), r.PathValue("terminal_id"), body.Data); err != nil {
		writeError(w, http.StatusBadRequest, "terminal_input_failed", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *API) interactiveTerminalResize(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Cols int `json:"cols"`
		Rows int `json:"rows"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if err := a.service.ResizeInteractiveTerminal(r.PathValue("id"), r.PathValue("terminal_id"), body.Cols, body.Rows); err != nil {
		writeError(w, http.StatusBadRequest, "terminal_resize_failed", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *API) closeInteractiveTerminal(w http.ResponseWriter, r *http.Request) {
	if err := a.service.CloseInteractiveTerminal(r.PathValue("id"), r.PathValue("terminal_id")); err != nil {
		writeError(w, http.StatusNotFound, "terminal_close_failed", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *API) interactiveTerminalEvents(w http.ResponseWriter, r *http.Request) {
	replay, frames, cancel, err := a.service.SubscribeInteractiveTerminal(r.PathValue("id"), r.PathValue("terminal_id"))
	if err != nil {
		writeError(w, http.StatusNotFound, "terminal_not_found", err.Error())
		return
	}
	defer cancel()
	a.serveLiveStream(w, r, func(stream liveStream) {
		for _, frame := range replay {
			if stream.send(frame) != nil {
				return
			}
		}
		pumpLiveStream(stream, frames)
	})
}
