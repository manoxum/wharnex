package httpapi

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"kernl.local/harness/backend/internal/app"
)

func (a *API) dockerOverview(w http.ResponseWriter, r *http.Request) {
	overview, err := a.service.DockerOverview(r.Context(), r.PathValue("id"))
	if err != nil {
		writeDockerError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, overview)
}

func (a *API) dockerContainerLogs(w http.ResponseWriter, r *http.Request) {
	tail := 200
	if raw := strings.TrimSpace(r.URL.Query().Get("tail")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid_tail", "tail must be an integer")
			return
		}
		tail = value
	}
	logs, err := a.service.DockerContainerLogs(r.Context(), r.PathValue("id"), r.PathValue("container_id"), tail)
	if err != nil {
		writeDockerError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, logs)
}

func (a *API) dockerContainerAction(w http.ResponseWriter, r *http.Request) {
	action := strings.ToLower(strings.TrimSpace(r.PathValue("action")))
	if action != "start" && action != "stop" && action != "restart" {
		writeError(w, http.StatusBadRequest, "unsupported_docker_action", "only start, stop and restart are supported")
		return
	}
	if err := a.service.DockerContainerAction(r.Context(), r.PathValue("id"), r.PathValue("container_id"), action); err != nil {
		writeDockerError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "action": action, "container_id": r.PathValue("container_id")})
}

func writeDockerError(w http.ResponseWriter, err error) {
	if errors.Is(err, app.ErrDockerUnavailable) {
		writeError(w, http.StatusServiceUnavailable, "docker_unavailable", err.Error())
		return
	}
	if errors.Is(err, app.ErrDockerProtectedContainer) {
		writeError(w, http.StatusConflict, "docker_protected_container", "Wharnex cannot stop or restart the backend container that is serving this request")
		return
	}
	message := strings.TrimSpace(err.Error())
	if strings.Contains(message, "invalid docker container identifier") || strings.Contains(message, "unsupported docker container action") {
		writeError(w, http.StatusBadRequest, "invalid_docker_request", message)
		return
	}
	writeError(w, http.StatusInternalServerError, "docker_operation_failed", message)
}
