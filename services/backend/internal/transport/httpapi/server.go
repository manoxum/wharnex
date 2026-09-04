package httpapi

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/app"
	"kernl.local/harness/backend/internal/audit"
	"kernl.local/harness/backend/internal/config"
	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/projectconfig"
	"kernl.local/harness/backend/internal/session"
)

type API struct {
	service *app.Service
	store   *session.Store
	bus     *audit.Bus
	cfg     config.Config
}

func New(service *app.Service, store *session.Store, bus *audit.Bus, cfg config.Config) http.Handler {
	a := &API{service: service, store: store, bus: bus, cfg: cfg}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", a.health)
	mux.HandleFunc("GET /api/config", a.config)
	mux.HandleFunc("GET /api/storage", a.storage)
	mux.HandleFunc("DELETE /api/storage", a.clearStorage)
	mux.HandleFunc("POST /api/projects/create", a.createProject)
	mux.HandleFunc("POST /api/projects/clone", a.cloneProject)
	mux.HandleFunc("POST /api/sessions", a.createSession)
	mux.HandleFunc("GET /api/sessions/{id}", a.getSession)
	mux.HandleFunc("DELETE /api/sessions/{id}", a.deleteSession)
	mux.HandleFunc("PUT /api/sessions/{id}/execution-mode", a.executionMode)
	mux.HandleFunc("PUT /api/sessions/{id}/automation-mode", a.automationMode)
	mux.HandleFunc("POST /api/sessions/{id}/messages", a.message)
	mux.HandleFunc("POST /api/sessions/{id}/manual-plan", a.manualPlan)
	mux.HandleFunc("POST /api/sessions/{id}/execution-bundle", a.executionBundle)
	mux.HandleFunc("POST /api/sessions/{id}/execute", a.execute)
	mux.HandleFunc("POST /api/sessions/{id}/apply", a.apply)
	mux.HandleFunc("POST /api/sessions/{id}/revert", a.revert)
	mux.HandleFunc("POST /api/sessions/{id}/self-restart", a.selfRestart)
	mux.HandleFunc("GET /api/sessions/{id}/events", a.events)
	mux.HandleFunc("GET /api/sessions/{id}/bundle", a.bundle)
	mux.HandleFunc("GET /api/sessions/{id}/context", a.contextFile)
	mux.HandleFunc("GET /api/sessions/{id}/context/inspection", a.contextInspection)
	mux.HandleFunc("POST /api/sessions/{id}/context/refresh", a.refreshContext)
	mux.HandleFunc("GET /api/sessions/{id}/project-config", a.projectConfig)
	mux.HandleFunc("PUT /api/sessions/{id}/project-config", a.updateProjectConfig)
	mux.HandleFunc("GET /api/sessions/{id}/files", a.files)
	mux.HandleFunc("POST /api/sessions/{id}/files", a.createWorkspacePath)
	mux.HandleFunc("PATCH /api/sessions/{id}/files", a.renameWorkspacePath)
	mux.HandleFunc("DELETE /api/sessions/{id}/files", a.deleteWorkspacePath)
	mux.HandleFunc("GET /api/sessions/{id}/file", a.readFile)
	mux.HandleFunc("PUT /api/sessions/{id}/file", a.writeFile)
	mux.HandleFunc("POST /api/sessions/{id}/terminal", a.terminal)
	mux.HandleFunc("POST /api/sessions/{id}/terminal/reset", a.resetTerminal)
	return cors(mux)
}

func (a *API) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok"})
}
func (a *API) config(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"planner": a.cfg.Planner, "sandbox": a.cfg.Sandbox, "model": a.cfg.OpenAIModel, "api_configured": a.cfg.OpenAIAPIKey != "", "chatgpt_web_embed": false})
}

func (a *API) storage(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, a.service.StorageUsage())
}

func (a *API) clearStorage(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Confirm string `json:"confirm"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if err := app.ValidateStorageClearConfirmation(body.Confirm); err != nil {
		writeError(w, http.StatusBadRequest, "storage_clear_confirmation_required", "type APAGAR WHARNESS to confirm complete Wharness data removal")
		return
	}
	if err := a.service.ClearAllData(); err != nil {
		writeError(w, http.StatusInternalServerError, "storage_clear_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "cleared"})
}

func (a *API) createProject(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ParentPath string `json:"parent_path"`
		Name       string `json:"name"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	root, err := a.service.CreateProject(r.Context(), body.ParentPath, body.Name)
	if err != nil {
		writeError(w, http.StatusBadRequest, "project_create_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"project_path": root, "config_file": projectconfig.FileName})
}

func (a *API) cloneProject(w http.ResponseWriter, r *http.Request) {
	var body struct {
		RepositoryURL string `json:"repository_url"`
		ParentPath    string `json:"parent_path"`
		Directory     string `json:"directory"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	root, err := a.service.CloneProject(r.Context(), body.RepositoryURL, body.ParentPath, body.Directory)
	if err != nil {
		writeError(w, http.StatusBadRequest, "project_clone_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"project_path": root, "config_file": projectconfig.FileName, "submodules": "recursive"})
}

func (a *API) createSession(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ProjectPath    string                `json:"project_path"`
		ExecutionMode  domain.ExecutionMode  `json:"execution_mode"`
		AutomationMode domain.AutomationMode `json:"automation_mode"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if strings.TrimSpace(body.ProjectPath) == "" {
		writeError(w, http.StatusBadRequest, "invalid_project_path", "project_path is required")
		return
	}
	item, err := a.service.StartSessionWithModes(r.Context(), body.ProjectPath, body.ExecutionMode, body.AutomationMode)
	if err != nil {
		writeError(w, http.StatusBadRequest, "session_create_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, item)
}

func (a *API) deleteSession(w http.ResponseWriter, r *http.Request) {
	if err := a.service.DeleteSession(r.PathValue("id")); err != nil {
		if errors.Is(err, session.ErrNotFound) {
			writeError(w, http.StatusNotFound, "session_not_found", "session not found")
			return
		}
		writeError(w, http.StatusBadRequest, "session_delete_failed", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *API) getSession(w http.ResponseWriter, r *http.Request) {
	item, err := a.service.GetSession(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusNotFound, "session_not_found", "session not found")
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (a *API) executionMode(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ExecutionMode domain.ExecutionMode `json:"execution_mode"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	item, err := a.service.SetExecutionMode(r.PathValue("id"), body.ExecutionMode)
	if err != nil {
		writeError(w, http.StatusBadRequest, "execution_mode_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (a *API) automationMode(w http.ResponseWriter, r *http.Request) {
	var body struct {
		AutomationMode domain.AutomationMode `json:"automation_mode"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	item, err := a.service.SetAutomationMode(r.PathValue("id"), body.AutomationMode)
	if err != nil {
		writeError(w, http.StatusBadRequest, "automation_mode_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (a *API) message(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Message      string `json:"message"`
		PlanningMode string `json:"planning_mode"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if strings.TrimSpace(body.Message) == "" {
		writeError(w, http.StatusBadRequest, "invalid_message", "message is required")
		return
	}
	result, item, err := a.service.SubmitMessageWithMode(r.Context(), r.PathValue("id"), body.Message, body.PlanningMode)
	if err != nil {
		writeError(w, http.StatusBadRequest, "planning_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"session": item, "turn": result.Turn, "plan": result.Plan, "manual_prompt": result.ManualPrompt})
}

func (a *API) manualPlan(w http.ResponseWriter, r *http.Request) {
	data, err := io.ReadAll(io.LimitReader(r.Body, 2<<20))
	if err != nil {
		writeError(w, 400, "read_failed", err.Error())
		return
	}
	item, err := a.service.SubmitManualPlan(r.PathValue("id"), data)
	if err != nil {
		writeError(w, 400, "invalid_plan", err.Error())
		return
	}
	writeJSON(w, 200, item)
}

func (a *API) executionBundle(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Filename string `json:"filename"`
		Base64   string `json:"content_base64"`
	}
	decoder := json.NewDecoder(io.LimitReader(r.Body, 24<<20))
	if err := decoder.Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_bundle_request", err.Error())
		return
	}
	if strings.TrimSpace(body.Filename) == "" || strings.TrimSpace(body.Base64) == "" {
		writeError(w, http.StatusBadRequest, "invalid_bundle_request", "filename and content_base64 are required")
		return
	}
	raw, err := base64.StdEncoding.DecodeString(body.Base64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_bundle_base64", "content_base64 is invalid")
		return
	}
	result, err := a.service.SubmitExecutionBundle(r.Context(), r.PathValue("id"), body.Filename, raw)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_execution_bundle", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (a *API) execute(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Approved bool `json:"approved"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	result, item, err := a.service.Execute(r.Context(), r.PathValue("id"), body.Approved)
	if err != nil {
		status := 400
		if errors.Is(err, app.ErrApprovalRequired) {
			status = 409
		}
		writeJSON(w, status, map[string]any{"error": map[string]any{"code": "execution_failed", "message": err.Error()}, "result": result, "session": item})
		return
	}
	writeJSON(w, 200, map[string]any{"result": result, "session": item})
}

func (a *API) apply(w http.ResponseWriter, r *http.Request) {
	item, err := a.service.ApplyToHost(r.Context(), r.PathValue("id"))
	if err != nil {
		writeError(w, 409, "apply_failed", err.Error())
		return
	}
	writeJSON(w, 200, item)
}

func (a *API) revert(w http.ResponseWriter, r *http.Request) {
	item, err := a.service.RevertHostChange(r.Context(), r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusConflict, "revert_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (a *API) selfRestart(w http.ResponseWriter, r *http.Request) {
	item, err := a.service.RestartSelfEvolution(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusConflict, "self_restart_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (a *API) events(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, 500, "stream_unsupported", "streaming unavailable")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	for _, event := range a.bus.History(r.PathValue("id")) {
		writeSSE(w, event)
		flusher.Flush()
	}
	ch, cancel := a.bus.Subscribe(r.PathValue("id"))
	defer cancel()
	heartbeat := time.NewTicker(20 * time.Second)
	defer heartbeat.Stop()
	for {
		select {
		case event, ok := <-ch:
			if !ok {
				return
			}
			writeSSE(w, event)
			flusher.Flush()
		case <-heartbeat.C:
			fmt.Fprint(w, ": heartbeat\n\n")
			flusher.Flush()
		case <-r.Context().Done():
			return
		}
	}
}

func (a *API) refreshContext(w http.ResponseWriter, r *http.Request) {
	item, err := a.service.RefreshContext(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "context_refresh_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (a *API) projectConfig(w http.ResponseWriter, r *http.Request) {
	cfg, err := a.service.ProjectConfig(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "project_config_read_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, cfg)
}

func (a *API) updateProjectConfig(w http.ResponseWriter, r *http.Request) {
	var cfg projectconfig.Config
	if !decodeJSON(w, r, &cfg) {
		return
	}
	stored, item, err := a.service.UpdateProjectConfig(r.PathValue("id"), cfg)
	if err != nil {
		writeError(w, http.StatusBadRequest, "project_config_write_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"config": stored, "session": item})
}

func (a *API) files(w http.ResponseWriter, r *http.Request) {
	entries, err := a.service.ListFiles(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "file_list_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"files": entries})
}

func (a *API) createWorkspacePath(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Path string `json:"path"`
		Kind string `json:"kind"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	file, err := a.service.CreateWorkspacePath(r.PathValue("id"), body.Path, body.Kind)
	if err != nil {
		writeError(w, http.StatusBadRequest, "workspace_create_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"status": "created", "file": file})
}

func (a *API) renameWorkspacePath(w http.ResponseWriter, r *http.Request) {
	var body struct {
		From string `json:"from"`
		To   string `json:"to"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if err := a.service.RenameWorkspacePath(r.PathValue("id"), body.From, body.To); err != nil {
		writeError(w, http.StatusBadRequest, "workspace_rename_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "renamed", "path": body.To})
}

func (a *API) deleteWorkspacePath(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Query().Get("path")
	if err := a.service.DeleteWorkspacePath(r.PathValue("id"), path); err != nil {
		writeError(w, http.StatusBadRequest, "workspace_delete_failed", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *API) readFile(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Query().Get("path")
	file, err := a.service.ReadFile(r.PathValue("id"), path)
	if err != nil {
		writeError(w, http.StatusBadRequest, "file_read_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, file)
}

func (a *API) writeFile(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Path           string `json:"path"`
		Content        string `json:"content"`
		ExpectedSHA256 string `json:"expected_sha256"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	file, err := a.service.WriteFile(r.PathValue("id"), body.Path, body.Content, body.ExpectedSHA256)
	if err != nil {
		writeError(w, http.StatusConflict, "file_write_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, file)
}

func (a *API) terminal(w http.ResponseWriter, r *http.Request) {
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
	var command domain.CommandSpec
	if !decodeJSON(w, r, &command) {
		return
	}
	result, err := a.service.RunTerminal(r.Context(), r.PathValue("id"), target, command)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": map[string]string{"code": "terminal_failed", "message": err.Error()}, "result": result})
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (a *API) resetTerminal(w http.ResponseWriter, r *http.Request) {
	if err := a.service.ResetTerminal(r.Context(), r.PathValue("id")); err != nil {
		writeError(w, http.StatusBadRequest, "terminal_reset_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok"})
}

func (a *API) bundle(w http.ResponseWriter, r *http.Request) {
	item, err := a.store.Get(r.PathValue("id"))
	if err != nil {
		writeError(w, 404, "session_not_found", "session not found")
		return
	}
	serveDownload(w, r, item.Context.ZipPath, "wharness-context-"+item.ID+".zip", "application/zip")
}
func (a *API) contextInspection(w http.ResponseWriter, r *http.Request) {
	inspection, err := a.service.ContextInspection(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "context_inspection_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, inspection)
}

func (a *API) contextFile(w http.ResponseWriter, r *http.Request) {
	item, err := a.store.Get(r.PathValue("id"))
	if err != nil {
		writeError(w, 404, "session_not_found", "session not found")
		return
	}
	serveDownload(w, r, item.Context.TextPath, "wharness-context-"+item.ID+".txt", "text/plain; charset=utf-8")
}

func serveDownload(w http.ResponseWriter, r *http.Request, path, name, contentType string) {
	if _, err := os.Stat(path); err != nil {
		writeError(w, 404, "artifact_missing", "context artifact not found")
		return
	}
	w.Header().Set("Content-Disposition", `attachment; filename="`+name+`"`)
	w.Header().Set("Content-Type", contentType)
	http.ServeFile(w, r, path)
}
func writeSSE(w io.Writer, value any) {
	data, _ := json.Marshal(value)
	fmt.Fprintf(w, "data: %s\n\n", data)
}

func decodeJSON(w http.ResponseWriter, r *http.Request, target any) bool {
	dec := json.NewDecoder(io.LimitReader(r.Body, 2<<20))
	dec.DisallowUnknownFields()
	if err := dec.Decode(target); err != nil {
		writeError(w, 400, "invalid_json", err.Error())
		return false
	}
	return true
}
func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]any{"error": map[string]string{"code": code, "message": message}})
}
func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin == "http://localhost:5173" || origin == "http://127.0.0.1:5173" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
		}
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
