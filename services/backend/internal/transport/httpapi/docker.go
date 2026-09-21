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

func (a *API) dockerComposeDown(w http.ResponseWriter, r *http.Request) {
	project := strings.TrimSpace(r.PathValue("project"))
	if err := a.service.DockerComposeDown(r.Context(), r.PathValue("id"), project); err != nil {
		writeDockerError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "project": project})
}

func (a *API) dockerComposeRedeploy(w http.ResponseWriter, r *http.Request) {
	project := strings.TrimSpace(r.PathValue("project"))
	if err := a.service.DockerComposeRedeploy(r.Context(), r.PathValue("id"), project); err != nil {
		writeDockerError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "project": project})
}

func (a *API) dockerResourceRemove(w http.ResponseWriter, r *http.Request) {
	kind := strings.ToLower(strings.TrimSpace(r.PathValue("kind")))
	if kind != "volume" && kind != "network" {
		writeError(w, http.StatusBadRequest, "unsupported_docker_resource", "only volume and network resources can be removed")
		return
	}
	name := strings.TrimSpace(r.PathValue("name"))
	if err := a.service.DockerResourceRemove(r.Context(), r.PathValue("id"), kind, name); err != nil {
		writeDockerError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "kind": kind, "name": name})
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
	if errors.Is(err, app.ErrDockerProtectedProject) {
		writeError(w, http.StatusConflict, "docker_protected_project", "Wharnex cannot modify the compose project that contains the backend serving this request")
		return
	}
	if errors.Is(err, app.ErrDockerRedeployUnavailable) {
		message := strings.TrimSpace(strings.TrimPrefix(err.Error(), app.ErrDockerRedeployUnavailable.Error()+":"))
		if message == "" {
			message = "Docker Compose redeploy is unavailable"
		}
		writeError(w, http.StatusConflict, "docker_redeploy_unavailable", message)
		return
	}
	if errors.Is(err, app.ErrDockerResourceInUse) {
		writeError(w, http.StatusConflict, "docker_resource_in_use", err.Error())
		return
	}
	message := strings.TrimSpace(err.Error())
	if strings.Contains(message, "invalid docker") || strings.Contains(message, "unsupported docker") {
		writeError(w, http.StatusBadRequest, "invalid_docker_request", message)
		return
	}
	writeError(w, http.StatusInternalServerError, "docker_operation_failed", message)
}
