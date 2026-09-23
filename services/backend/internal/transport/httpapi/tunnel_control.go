package httpapi

import (
	"net/http"
	"strings"
)

func (a *API) controlTunnel(w http.ResponseWriter, r *http.Request) {
	var body struct {
		InstanceID string `json:"instance_id"`
		Action     string `json:"action"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	instanceID := strings.TrimSpace(body.InstanceID)
	action := strings.ToLower(strings.TrimSpace(body.Action))
	if instanceID == "" || (action != "pause" && action != "stop" && action != "resume") {
		writeError(w, http.StatusBadRequest, "tunnel_control_invalid", "instance_id and an action of pause, stop, or resume are required")
		return
	}
	if err := a.service.ControlRemoteInput(r.Context(), instanceID, action); err != nil {
		writeError(w, http.StatusBadRequest, "tunnel_control_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"instance_id": instanceID, "action": action, "remote_input": a.service.RemoteInputStatus()})
}
