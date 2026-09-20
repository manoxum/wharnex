package httpapi

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/app"
	"kernl.local/harness/backend/internal/audit"
	"kernl.local/harness/backend/internal/config"
	"kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/documentpreview"
	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/projectconfig"
	"kernl.local/harness/backend/internal/session"
	"kernl.local/harness/backend/internal/utility"
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
	mux.HandleFunc("GET /api/execution-concurrency", a.executionConcurrency)
	mux.HandleFunc("PUT /api/execution-concurrency", a.updateExecutionConcurrency)
	mux.HandleFunc("GET /api/tunnel-config", a.tunnelConfig)
	mux.HandleFunc("PUT /api/tunnel-config", a.updateTunnelConfig)
	mux.HandleFunc("GET /api/tunnel/providers", a.tunnelProviders)
	mux.HandleFunc("POST /api/tunnel/test", a.testTunnel)
	mux.HandleFunc("POST /api/tunnel/connections", a.connectTunnelProvider)
	mux.HandleFunc("DELETE /api/tunnel/connections/{credential_ref}", a.disconnectTunnelProvider)
	mux.HandleFunc("GET /api/remote-storage-config", a.remoteStorageConfig)
	mux.HandleFunc("PUT /api/remote-storage-config", a.updateRemoteStorageConfig)
	mux.HandleFunc("GET /api/remote-storage/providers", a.remoteStorageProviders)
	mux.HandleFunc("POST /api/remote-storage/connections", a.connectRemoteStorage)
	mux.HandleFunc("POST /api/remote-storage/connections/check", a.checkRemoteStorage)
	mux.HandleFunc("GET /api/artifact-settings", a.artifactSettings)
	mux.HandleFunc("PUT /api/artifact-settings", a.updateArtifactSettings)
	mux.HandleFunc("GET /api/artifacts", a.managedArtifacts)
	mux.HandleFunc("DELETE /api/artifacts/{session_id}/{artifact_id}", a.deleteManagedArtifact)
	mux.HandleFunc("POST /api/database/postgres/test", a.postgresTest)
	mux.HandleFunc("POST /api/database/postgres/catalog", a.postgresCatalog)
	mux.HandleFunc("POST /api/database/postgres/query", a.postgresQuery)
	mux.HandleFunc("GET /api/language-settings", a.languageSettings)
	mux.HandleFunc("PUT /api/language-settings", a.updateLanguageSettings)
	mux.HandleFunc("GET /api/bundle-quota", a.bundleQuota)
	// One compact response for every chat of a project. The attention center
	// previously fetched each chat's whole Session (1-2 MB each), which a
	// workspace with many chats could not survive.
	mux.HandleFunc("GET /api/workspace-attention", a.workspaceAttention)
	// Durable workspace chat index and transcripts (previously localStorage).
	mux.HandleFunc("GET /api/workspace-chats", a.listWorkspaceChats)
	mux.HandleFunc("PUT /api/workspace-chats/{id}", a.saveWorkspaceChat)
	mux.HandleFunc("PATCH /api/workspace-chats/{id}/remote", a.updateWorkspaceChatRemote)
	mux.HandleFunc("GET /api/workspace-chats/{id}/binding-recovery", a.recoverWorkspaceChatBinding)
	mux.HandleFunc("PATCH /api/workspace-chats/{id}/saved", a.setWorkspaceChatSaved)
	mux.HandleFunc("PATCH /api/workspace-chats/{id}/archived", a.setWorkspaceChatArchived)
	mux.HandleFunc("DELETE /api/workspace-chats/{id}", a.deleteWorkspaceChat)
	mux.HandleFunc("GET /api/workspace-chats/{id}/items", a.listWorkspaceChatItems)
	mux.HandleFunc("PUT /api/workspace-chats/{id}/items", a.replaceWorkspaceChatItems)
	// Durable ChatGPT browser-agent scheduler. Electron is a lease-based
	// executor; PostgreSQL remains authoritative across Desktop restarts.
	mux.HandleFunc("GET /api/chat-agent/provider", a.chatAgentProviderState)
	mux.HandleFunc("PUT /api/chat-agent/provider", a.updateChatAgentProviderState)
	mux.HandleFunc("POST /api/chat-agent/provider/rate-limit", a.recordChatAgentRateLimit)
	mux.HandleFunc("POST /api/chat-agent/provider/valid-bundle", a.recordChatAgentValidBundle)
	mux.HandleFunc("POST /api/chat-agent/tasks", a.enqueueChatAgentTask)
	mux.HandleFunc("GET /api/chat-agent/tasks", a.listChatAgentTasks)
	mux.HandleFunc("GET /api/chat-agent/tasks/summary", a.chatAgentTaskSummary)
	mux.HandleFunc("POST /api/chat-agent/tasks/claim", a.claimChatAgentTask)
	mux.HandleFunc("POST /api/chat-agent/tasks/{id}/assign", a.assignChatAgentTask)
	mux.HandleFunc("POST /api/chat-agent/tasks/cancel-lineage", a.cancelChatAgentLineage)
	mux.HandleFunc("POST /api/chat-agent/tasks/{id}/start", a.startChatAgentTask)
	mux.HandleFunc("POST /api/chat-agent/tasks/{id}/heartbeat", a.heartbeatChatAgentTask)
	mux.HandleFunc("POST /api/chat-agent/tasks/{id}/checkpoint", a.checkpointChatAgentTask)
	mux.HandleFunc("POST /api/chat-agent/tasks/{id}/wait", a.waitChatAgentTask)
	mux.HandleFunc("POST /api/chat-agent/tasks/{id}/complete", a.completeChatAgentTask)
	mux.HandleFunc("POST /api/chat-agent/tasks/{id}/fail", a.failChatAgentTask)
	mux.HandleFunc("POST /api/chat-agent/tasks/{id}/attention", a.attentionChatAgentTask)
	mux.HandleFunc("GET /api/storage", a.storage)
	mux.HandleFunc("POST /api/storage/prune", a.pruneStorage)
	mux.HandleFunc("DELETE /api/storage", a.clearStorage)
	mux.HandleFunc("POST /api/projects/create", a.createProject)
	mux.HandleFunc("POST /api/projects/clone", a.cloneProject)
	mux.HandleFunc("POST /api/sessions", a.createSession)
	mux.HandleFunc("GET /api/sessions/{id}", a.getSession)
	mux.HandleFunc("DELETE /api/sessions/{id}", a.deleteSession)
	mux.HandleFunc("PUT /api/sessions/{id}/execution-mode", a.executionMode)
	mux.HandleFunc("PUT /api/sessions/{id}/automation-mode", a.automationMode)
	mux.HandleFunc("PUT /api/sessions/{id}/debug-mode", a.debugMode)
	mux.HandleFunc("PUT /api/sessions/{id}/effort-level", a.effortLevel)
	mux.HandleFunc("PUT /api/sessions/{id}/reasoning-effort", a.reasoningEffort)
	mux.HandleFunc("PUT /api/sessions/{id}/chat-transport-mode", a.chatTransportMode)
	mux.HandleFunc("PUT /api/sessions/{id}/knowledge-sharing", a.knowledgeSharing)
	mux.HandleFunc("PUT /api/sessions/{id}/chat-id", a.chatID)
	mux.HandleFunc("POST /api/sessions/{id}/archive", a.archiveChat)
	mux.HandleFunc("POST /api/sessions/{id}/restore", a.restoreChat)
	mux.HandleFunc("POST /api/sessions/{id}/messages", a.message)
	mux.HandleFunc("POST /api/sessions/{id}/composer-bundle-preview", a.composerBundlePreview)
	mux.HandleFunc("POST /api/sessions/{id}/plans/{request_id}/approve", a.approvePlan)
	mux.HandleFunc("POST /api/sessions/{id}/plans/{request_id}/correct", a.correctPlan)
	mux.HandleFunc("POST /api/sessions/{id}/plans/{request_id}/reject", a.rejectPlan)
	mux.HandleFunc("POST /api/sessions/{id}/execution-plan/reject", a.rejectExecutionPlan)
	mux.HandleFunc("POST /api/sessions/{id}/execution-plan/adjust", a.adjustExecutionPlan)
	mux.HandleFunc("POST /api/sessions/{id}/remote-input", a.remoteInput)
	mux.HandleFunc("POST /api/sessions/{id}/remote-input/events", a.remoteInputEvent)
	mux.HandleFunc("POST /api/sessions/{id}/remote-input/failures", a.remoteInputFailure)
	mux.HandleFunc("POST /api/sessions/{id}/manual-plan", a.manualPlan)
	mux.HandleFunc("POST /api/sessions/{id}/execution-bundle", a.executionBundle)
	mux.HandleFunc("POST /api/sessions/{id}/policy-repair", a.retryPolicyRepair)
	mux.HandleFunc("POST /api/sessions/{id}/failure-repair", a.requestFailureRepair)
	mux.HandleFunc("POST /api/sessions/{id}/failed-request/retry", a.retryFailedRequest)
	mux.HandleFunc("POST /api/sessions/{id}/request/cancel", a.cancelPendingRequest)
	mux.HandleFunc("POST /api/sessions/{id}/execute", a.execute)
	mux.HandleFunc("POST /api/sessions/{id}/debug/approve", a.approveDebug)
	mux.HandleFunc("POST /api/sessions/{id}/interactive/cancel", a.cancelInteractive)
	mux.HandleFunc("POST /api/sessions/{id}/dependency-network-retry", a.retryDependencyNetwork)
	mux.HandleFunc("POST /api/sessions/{id}/host-dependency-repair", a.retryHostDependencyRepair)
	mux.HandleFunc("POST /api/sessions/{id}/interrupted-execution/resume", a.resumeInterruptedExecution)
	mux.HandleFunc("POST /api/sessions/{id}/interrupted-execution/discard", a.discardInterruptedExecution)
	mux.HandleFunc("POST /api/sessions/{id}/apply", a.apply)
	mux.HandleFunc("POST /api/sessions/{id}/pending-changes/reject", a.rejectPendingChanges)
	mux.HandleFunc("POST /api/sessions/{id}/revert", a.revert)
	mux.HandleFunc("POST /api/sessions/{id}/restore-reverted", a.restoreReverted)
	mux.HandleFunc("POST /api/sessions/{id}/self-restart", a.selfRestart)
	mux.HandleFunc("GET /api/sessions/{id}/self-evolution/evidence", a.selfEvolutionEvidence)
	mux.HandleFunc("POST /api/sessions/{id}/self-evolution/analyze", a.selfEvolutionAnalyze)
	mux.HandleFunc("POST /api/sessions/{id}/self-evolution/evidence/resolve", a.selfEvolutionResolveEvidence)
	mux.HandleFunc("GET /api/self-evolution/block", a.selfEvolutionBlock)
	mux.HandleFunc("POST /api/self-evolution/block/release", a.releaseSelfEvolutionBlock)
	mux.HandleFunc("GET /api/sessions/{id}/events", a.events)
	mux.HandleFunc("GET /api/sessions/{id}/events/history", a.eventHistory)
	mux.HandleFunc("GET /api/sessions/{id}/execution-errors", a.executionErrors)
	mux.HandleFunc("GET /api/sessions/{id}/knowledge", a.projectKnowledge)
	mux.HandleFunc("GET /api/sessions/{id}/knowledge/catalog", a.knowledgeCatalog)
	mux.HandleFunc("POST /api/sessions/{id}/knowledge/export", a.knowledgeExport)
	mux.HandleFunc("POST /api/sessions/{id}/knowledge/import", a.knowledgeImport)
	mux.HandleFunc("POST /api/sessions/{id}/knowledge/clear", a.knowledgeClear)
	mux.HandleFunc("POST /api/sessions/{id}/knowledge/adopt-legacy-files", a.knowledgeAdoptLegacyFiles)
	mux.HandleFunc("POST /api/sessions/{id}/knowledge/consolidate", a.knowledgeConsolidate)
	mux.HandleFunc("GET /api/sessions/{id}/requests/{request_id}/knowledge", a.requestKnowledge)
	mux.HandleFunc("GET /api/sessions/{id}/requests/{request_id}/continuation", a.requestContinuation)
	mux.HandleFunc("GET /api/sessions/{id}/todos", a.projectTodos)
	mux.HandleFunc("POST /api/sessions/{id}/todos", a.createProjectTodo)
	mux.HandleFunc("PATCH /api/sessions/{id}/todos/{todo_id}", a.updateProjectTodo)
	mux.HandleFunc("POST /api/sessions/{id}/todos/{todo_id}/classify", a.classifyProjectTodo)
	mux.HandleFunc("PATCH /api/sessions/{id}/todos/{todo_id}/archived", a.archiveProjectTodo)
	mux.HandleFunc("DELETE /api/sessions/{id}/todos/{todo_id}", a.deleteProjectTodo)
	mux.HandleFunc("POST /api/sessions/{id}/chat-export", a.chatExport)
	mux.HandleFunc("GET /api/sessions/{id}/bundle", a.bundle)
	mux.HandleFunc("GET /api/sessions/{id}/chat-files", a.chatFiles)
	mux.HandleFunc("POST /api/sessions/{id}/chat-files/{artifact_id}/library", a.saveChatFileToLibrary)
	mux.HandleFunc("GET /api/sessions/{id}/artifacts", a.artifacts)
	mux.HandleFunc("POST /api/sessions/{id}/artifacts", a.persistArtifact)
	mux.HandleFunc("GET /api/sessions/{id}/artifacts/{artifact_id}", a.artifactDownload)
	mux.HandleFunc("GET /api/sessions/{id}/artifacts/{artifact_id}/entries", a.artifactEntries)
	mux.HandleFunc("GET /api/sessions/{id}/artifacts/{artifact_id}/presentation", a.artifactPresentation)
	mux.HandleFunc("GET /api/sessions/{id}/artifacts/{artifact_id}/entry", a.artifactEntry)
	mux.HandleFunc("GET /api/sessions/{id}/context", a.contextFile)
	mux.HandleFunc("GET /api/sessions/{id}/context/maps", a.contextMaps)
	mux.HandleFunc("GET /api/sessions/{id}/context/inspection", a.contextInspection)
	mux.HandleFunc("POST /api/sessions/{id}/attachment/inspection", a.attachmentInspection)
	mux.HandleFunc("POST /api/sessions/{id}/reference/inspection", a.referenceInspection)
	mux.HandleFunc("GET /api/sessions/{id}/known-projects", a.knownProjects)
	mux.HandleFunc("POST /api/sessions/{id}/context/refresh", a.refreshContext)
	mux.HandleFunc("PUT /api/sessions/{id}/related-projects", a.relatedProjects)
	mux.HandleFunc("GET /api/sessions/{id}/project-config", a.projectConfig)
	mux.HandleFunc("PUT /api/sessions/{id}/project-config", a.updateProjectConfig)
	mux.HandleFunc("GET /api/sessions/{id}/files", a.files)
	mux.HandleFunc("POST /api/sessions/{id}/files", a.createWorkspacePath)
	mux.HandleFunc("PATCH /api/sessions/{id}/files", a.renameWorkspacePath)
	mux.HandleFunc("DELETE /api/sessions/{id}/files", a.deleteWorkspacePath)
	mux.HandleFunc("GET /api/sessions/{id}/file", a.readFile)
	mux.HandleFunc("GET /api/sessions/{id}/file/preview", a.previewFile)
	mux.HandleFunc("PUT /api/sessions/{id}/file", a.writeFile)
	mux.HandleFunc("POST /api/sessions/{id}/translate-markdown", a.translateMarkdown)
	mux.HandleFunc("POST /api/sessions/{id}/terminal", a.terminal)
	mux.HandleFunc("POST /api/sessions/{id}/terminal/sessions", a.openInteractiveTerminal)
	mux.HandleFunc("GET /api/sessions/{id}/terminal/sessions/{terminal_id}/events", a.interactiveTerminalEvents)
	mux.HandleFunc("POST /api/sessions/{id}/terminal/sessions/{terminal_id}/input", a.interactiveTerminalInput)
	mux.HandleFunc("POST /api/sessions/{id}/terminal/sessions/{terminal_id}/resize", a.interactiveTerminalResize)
	mux.HandleFunc("DELETE /api/sessions/{id}/terminal/sessions/{terminal_id}", a.closeInteractiveTerminal)
	mux.HandleFunc("GET /api/sessions/{id}/orchestrator/overview", a.orchestratorOverview)
	mux.HandleFunc("POST /api/sessions/{id}/orchestrator/plans/propose", a.orchestratorProposePlan)
	mux.HandleFunc("POST /api/sessions/{id}/orchestrator/plans/import", a.orchestratorImportPlan)
	mux.HandleFunc("POST /api/sessions/{id}/orchestrator/plans/import-bundle", a.orchestratorImportPlanBundle)
	mux.HandleFunc("POST /api/sessions/{id}/orchestrator/planning/{request_id}/retry", a.orchestratorRetryPlan)
	mux.HandleFunc("POST /api/sessions/{id}/orchestrator/plans/{plan_id}/approve", a.orchestratorApprovePlan)
	mux.HandleFunc("POST /api/sessions/{id}/orchestrator/tasks", a.orchestratorCreateTask)
	mux.HandleFunc("POST /api/sessions/{id}/orchestrator/tasks/{task_id}/transition", a.orchestratorTransitionTask)
	mux.HandleFunc("POST /api/sessions/{id}/orchestrator/tasks/{task_id}/start", a.orchestratorStartTask)
	mux.HandleFunc("GET /api/sessions/{id}/orchestrator/tasks/{task_id}/runs", a.orchestratorTaskRuns)
	mux.HandleFunc("POST /api/sessions/{id}/terminal/reset", a.resetTerminal)
	a.registerGitRoutes(mux)
	a.registerConflictRoutes(mux)
	return cors(mux, allowedOrigins(cfg.FrontendOrigin))
}

// allowedOrigins is the fixed localhost/127.0.0.1:5173 pair every checkout
// accepted historically, plus this instance's own configured frontend origin
// (HARNESS_FRONTEND_ORIGIN) — needed because two checkouts of this repo can
// each run their frontend on a different loopback port to stay isolated.
func allowedOrigins(configured string) []string {
	origins := []string{"http://localhost:5173", "http://127.0.0.1:5173"}
	for _, origin := range origins {
		if origin == configured {
			return origins
		}
	}
	return append(origins, configured)
}

func (a *API) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok"})
}
func (a *API) config(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"planner": a.cfg.Planner, "sandbox": a.cfg.Sandbox, "model": a.cfg.OpenAIModel, "version": a.cfg.Version, "api_configured": a.cfg.OpenAIAPIKey != "", "chatgpt_web_embed": false, "remote_input": a.tunnelStatus()})
}

// executionConcurrency exposes how many plans one project may verify at a
// time, so the workspace queue view can present the limit it is queueing
// against instead of leaving the operator to infer it from behavior.
func (a *API) executionConcurrency(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"concurrency": a.service.ExecutionConcurrency(),
		"max":         a.service.MaxExecutionConcurrency(),
	})
}

// updateExecutionConcurrency applies a new limit at runtime. Work already
// running is never interrupted by lowering it: the project simply admits
// nothing new until it drains under the new limit.
func (a *API) updateExecutionConcurrency(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		Concurrency int `json:"concurrency"`
	}
	if !decodeJSON(w, r, &payload) {
		return
	}
	if payload.Concurrency < 1 {
		writeError(w, http.StatusBadRequest, "invalid_concurrency", "concurrency must be at least 1")
		return
	}
	concurrency := payload.Concurrency
	if concurrency > a.service.MaxExecutionConcurrency() {
		concurrency = a.service.MaxExecutionConcurrency()
	}
	if err := config.SaveExecutionSettings(a.cfg.ExecutionSettingsFile, config.ExecutionSettingsDocument{
		Version: 1, ProjectConcurrency: concurrency,
	}); err != nil {
		writeError(w, http.StatusInternalServerError, "execution_settings_save_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"concurrency": a.service.SetExecutionConcurrency(concurrency),
		"max":         a.service.MaxExecutionConcurrency(),
	})
}

func (a *API) tunnelStatus() app.RemoteInputStatus {
	status := a.service.RemoteInputStatus()
	document, err := config.ReadTunnelDocument(a.cfg.Tunnel)
	if err != nil {
		return status
	}
	return mergeConfiguredTunnelURLs(document, status)
}

func mergeConfiguredTunnelURLs(document config.TunnelDocument, status app.RemoteInputStatus) app.RemoteInputStatus {
	configured := make(map[string]string, len(document.Instances))
	for _, instance := range document.Instances {
		configured[instance.ID] = strings.TrimRight(strings.TrimSpace(instance.PublicURL), "/")
	}
	active := make([]app.RemoteInputInstanceStatus, 0, len(status.Instances))
	for _, instance := range status.Instances {
		publicURL, exists := configured[instance.ID]
		if !exists {
			continue
		}
		if instance.PublicURL == "" {
			instance.PublicURL = publicURL
		}
		active = append(active, instance)
	}
	status.Instances = active
	if len(active) == 0 {
		status.Enabled = false
		status.Provider = ""
		status.Mode = "local_attachments"
	}
	return status
}

func configuredTunnelInstanceIDs(document config.TunnelDocument, requested []string) []string {
	configured := make(map[string]struct{}, len(document.Instances))
	for _, instance := range document.Instances {
		configured[instance.ID] = struct{}{}
	}
	selected := make([]string, 0, len(requested))
	for _, instanceID := range requested {
		if _, exists := configured[instanceID]; exists {
			selected = append(selected, instanceID)
		}
	}
	return selected
}

func (a *API) tunnelConfig(w http.ResponseWriter, _ *http.Request) {
	document, err := config.ReadTunnelDocument(a.cfg.Tunnel)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "tunnel_config_read_failed", err.Error())
		return
	}
	restartRequired := false
	if a.service != nil {
		restartRequired = tunnelRuntimeDiffers(document, a.service.RemoteInputStatus())
	}
	writeJSON(w, http.StatusOK, map[string]any{"config": document, "restart_required": restartRequired})
}

func tunnelRuntimeDiffers(document config.TunnelDocument, status app.RemoteInputStatus) bool {
	if len(document.Instances) != len(status.Instances) {
		return true
	}
	runtimeByID := make(map[string]app.RemoteInputInstanceStatus, len(status.Instances))
	for _, runtime := range status.Instances {
		runtimeByID[runtime.ID] = runtime
	}
	for _, configured := range document.Instances {
		runtime, exists := runtimeByID[configured.ID]
		if !exists || !strings.EqualFold(configured.Provider, runtime.Provider) || configured.Priority != runtime.Priority {
			return true
		}
	}
	return false
}

func (a *API) updateTunnelConfig(w http.ResponseWriter, r *http.Request) {
	raw, err := io.ReadAll(io.LimitReader(r.Body, (256<<10)+1))
	if err != nil || len(raw) > 256<<10 {
		writeError(w, http.StatusBadRequest, "invalid_json", "tunnel config exceeds the 256 KiB limit")
		return
	}
	document, err := config.DecodeTunnelDocument(raw)
	if err != nil {
		writeError(w, http.StatusBadRequest, "tunnel_config_invalid", err.Error())
		return
	}
	if err := config.SaveTunnelDocument(a.cfg.Tunnel, document); err != nil {
		writeError(w, http.StatusBadRequest, "tunnel_config_invalid", err.Error())
		return
	}
	saved, err := config.ReadTunnelDocument(a.cfg.Tunnel)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "tunnel_config_read_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"config": saved, "restart_required": true})
}

func (a *API) tunnelProviders(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"providers": a.service.TunnelProviders()})
}

func (a *API) testTunnel(w http.ResponseWriter, r *http.Request) {
	var body struct {
		InstanceID string `json:"instance_id"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	var target app.RemoteInputInstanceStatus
	found := false
	for _, instance := range a.tunnelStatus().Instances {
		if instance.ID == body.InstanceID {
			target = instance
			found = true
			break
		}
	}
	if !found || target.PublicURL == "" {
		writeError(w, http.StatusNotFound, "tunnel_not_ready", "the selected tunnel has no active public URL")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(target.PublicURL, "/")+"/status", nil)
	if err != nil {
		writeError(w, http.StatusBadRequest, "tunnel_test_failed", err.Error())
		return
	}
	started := time.Now()
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		writeError(w, http.StatusBadGateway, "tunnel_test_failed", err.Error())
		return
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 400 {
		writeError(w, http.StatusBadGateway, "tunnel_test_failed", fmt.Sprintf("public status returned HTTP %d", response.StatusCode))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "instance_id": target.ID, "public_url": target.PublicURL, "latency_ms": time.Since(started).Milliseconds()})
}

func (a *API) connectTunnelProvider(w http.ResponseWriter, r *http.Request) {
	var request app.TunnelProviderEnrollmentRequest
	if !decodeJSON(w, r, &request) {
		return
	}
	enrollment, err := a.service.EnrollTunnelProvider(r.Context(), request)
	if err != nil {
		writeError(w, http.StatusBadRequest, "tunnel_provider_connection_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, enrollment)
}

func (a *API) disconnectTunnelProvider(w http.ResponseWriter, r *http.Request) {
	if err := a.service.DisconnectTunnelProvider(r.Context(), r.PathValue("credential_ref")); err != nil {
		writeError(w, http.StatusBadRequest, "tunnel_provider_disconnect_failed", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *API) remoteStorageConfig(w http.ResponseWriter, _ *http.Request) {
	document, err := config.ReadRemoteStorageDocument(a.cfg.RemoteStorage)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "remote_storage_config_read_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"config": document, "restart_required": false})
}

func (a *API) updateRemoteStorageConfig(w http.ResponseWriter, r *http.Request) {
	previous, _ := config.ReadRemoteStorageDocument(a.cfg.RemoteStorage)
	raw, err := io.ReadAll(io.LimitReader(r.Body, (2<<20)+1))
	if err != nil || len(raw) > 2<<20 {
		writeError(w, http.StatusBadRequest, "invalid_json", "remote storage config exceeds the 2 MiB limit")
		return
	}
	document, err := config.DecodeRemoteStorageDocument(raw)
	if err != nil {
		writeError(w, http.StatusBadRequest, "remote_storage_config_invalid", err.Error())
		return
	}
	// Until the dedicated tunnel document is first saved, keep the legacy
	// TryCloudflare entry invisible but intact so editing storage drivers cannot
	// accidentally disable the migrated tunnel transport.
	if _, statErr := os.Stat(a.cfg.Tunnel.ConfigFile); errors.Is(statErr, os.ErrNotExist) {
		known := make(map[string]struct{}, len(document.Instances))
		for _, instance := range document.Instances {
			known[instance.ID] = struct{}{}
		}
		for _, instance := range previous.Instances {
			if !strings.EqualFold(instance.Provider, "trycloudflare") {
				continue
			}
			if _, exists := known[instance.ID]; !exists {
				document.Instances = append(document.Instances, instance)
			}
		}
	}
	if err := config.SaveRemoteStorageDocument(a.cfg.RemoteStorage, document); err != nil {
		writeError(w, http.StatusBadRequest, "remote_storage_config_invalid", err.Error())
		return
	}
	cleanupWarning := false
	if a.service != nil {
		active := make(map[string]struct{}, len(document.Instances))
		for _, instance := range document.Instances {
			if instance.RcloneRemote != "" {
				active[instance.RcloneRemote] = struct{}{}
			}
		}
		for _, instance := range previous.Instances {
			if instance.RcloneRemote == "" {
				continue
			}
			if _, exists := active[instance.RcloneRemote]; exists {
				continue
			}
			if err := a.service.DisconnectRemoteStorage(r.Context(), instance.RcloneRemote); err != nil {
				cleanupWarning = true
			}
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"config": document, "restart_required": true, "credential_cleanup_warning": cleanupWarning})
}

func (a *API) remoteStorageProviders(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"providers": a.service.RemoteStorageProviders(r.Context())})
}

func (a *API) connectRemoteStorage(w http.ResponseWriter, r *http.Request) {
	var request app.RemoteStorageConnectionRequest
	if !decodeJSON(w, r, &request) {
		return
	}
	connection, err := a.service.ConnectRemoteStorage(r.Context(), request)
	if err != nil {
		writeError(w, http.StatusBadRequest, "remote_storage_connection_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, connection)
}

func (a *API) checkRemoteStorage(w http.ResponseWriter, r *http.Request) {
	var request struct {
		Remote string `json:"remote"`
	}
	if !decodeJSON(w, r, &request) {
		return
	}
	if err := a.service.CheckRemoteStorage(r.Context(), request.Remote); err != nil {
		writeError(w, http.StatusBadRequest, "remote_storage_check_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"connected": true})
}

func (a *API) artifactSettings(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, a.service.ArtifactSettings())
}

func (a *API) updateArtifactSettings(w http.ResponseWriter, r *http.Request) {
	var body struct {
		RetentionDays     int `json:"retention_days"`
		BundleWindowLimit int `json:"bundle_window_limit"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if body.BundleWindowLimit < 1 {
		body.BundleWindowLimit = a.service.BundleWindowLimit()
	}
	document := config.ArtifactSettingsDocument{Version: 1, RetentionDays: body.RetentionDays, BundleWindowLimit: body.BundleWindowLimit}
	if err := config.SaveArtifactSettings(a.cfg.Artifacts, document); err != nil {
		writeError(w, http.StatusBadRequest, "artifact_settings_invalid", err.Error())
		return
	}
	a.service.SetArtifactRetentionDays(body.RetentionDays)
	a.service.SetBundleWindowLimit(body.BundleWindowLimit)
	before := time.Now().UTC().Add(-time.Duration(body.RetentionDays) * 24 * time.Hour)
	if err := a.service.CleanupArtifacts(r.Context(), before); err != nil {
		writeError(w, http.StatusInternalServerError, "artifact_cleanup_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, a.service.ArtifactSettings())
}

func (a *API) languageSettings(w http.ResponseWriter, _ *http.Request) {
	document, err := config.ReadLanguageSettings(a.cfg.LanguageSettingsFile)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "language_settings_read_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, document)
}

func (a *API) updateLanguageSettings(w http.ResponseWriter, r *http.Request) {
	var document config.LanguageSettingsDocument
	if !decodeJSON(w, r, &document) {
		return
	}
	if err := config.SaveLanguageSettings(a.cfg.LanguageSettingsFile, document); err != nil {
		writeError(w, http.StatusBadRequest, "language_settings_invalid", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, document)
}

func (a *API) translateMarkdown(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 8<<20)
	var body struct {
		TargetLanguage string `json:"target_language"`
		Markdown       string `json:"markdown"`
	}
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_translation_request", err.Error())
		return
	}
	settings, err := config.ReadLanguageSettings(a.cfg.LanguageSettingsFile)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "language_settings_read_failed", err.Error())
		return
	}
	allowed := false
	for _, language := range settings.TranslationLanguages {
		if language == body.TargetLanguage {
			allowed = true
			break
		}
	}
	if !allowed {
		writeError(w, http.StatusBadRequest, "translation_language_disabled", "target language is not enabled in language settings")
		return
	}
	result, err := a.service.TranslateMarkdown(r.Context(), r.PathValue("id"), utility.LanguageCode(body.TargetLanguage), body.Markdown)
	if err != nil {
		switch {
		case errors.Is(err, session.ErrNotFound):
			writeError(w, http.StatusNotFound, "session_not_found", err.Error())
		case errors.Is(err, utility.ErrUnavailable):
			writeError(w, http.StatusServiceUnavailable, "utility_unavailable", "Markdown Translator is unavailable")
		default:
			writeError(w, http.StatusBadGateway, "translation_failed", err.Error())
		}
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (a *API) bundleQuota(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, a.service.BundleQuota(time.Now().UTC()))
}

func (a *API) artifacts(w http.ResponseWriter, r *http.Request) {
	items, err := a.service.ListArtifacts(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusNotFound, "session_not_found", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"artifacts": items})
}

func (a *API) chatExport(w http.ResponseWriter, r *http.Request) {
	var input app.ChatExportInput
	r.Body = http.MaxBytesReader(w, r.Body, 32<<20)
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_chat_export", err.Error())
		return
	}
	tmp, err := os.CreateTemp("", "wharness-chat-export-*.zip")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "chat_export_failed", err.Error())
		return
	}
	defer func() {
		_ = tmp.Close()
		_ = os.Remove(tmp.Name())
	}()
	summary, err := a.service.WriteChatExport(r.Context(), r.PathValue("id"), input, tmp)
	if err != nil {
		if errors.Is(err, session.ErrNotFound) {
			writeError(w, http.StatusNotFound, "session_not_found", err.Error())
			return
		}
		writeError(w, http.StatusInternalServerError, "chat_export_failed", err.Error())
		return
	}
	if _, err := tmp.Seek(0, io.SeekStart); err != nil {
		writeError(w, http.StatusInternalServerError, "chat_export_failed", err.Error())
		return
	}
	stat, err := tmp.Stat()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "chat_export_failed", err.Error())
		return
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", `attachment; filename="`+strings.ReplaceAll(summary.Filename, `"`, "")+`"`)
	w.Header().Set("Content-Length", fmt.Sprintf("%d", stat.Size()))
	w.WriteHeader(http.StatusOK)
	_, _ = io.Copy(w, tmp)
}

func (a *API) persistArtifact(w http.ResponseWriter, r *http.Request) {
	var body struct {
		RequestID     string `json:"request_id"`
		Direction     string `json:"direction"`
		Kind          string `json:"kind"`
		Filename      string `json:"filename"`
		ContentType   string `json:"content_type"`
		ContentBase64 string `json:"content_base64"`
	}
	decoder := json.NewDecoder(io.LimitReader(r.Body, (350<<20)+1))
	if err := decoder.Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_artifact", err.Error())
		return
	}
	raw, err := base64.StdEncoding.DecodeString(body.ContentBase64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_artifact_base64", "content_base64 is invalid")
		return
	}
	record, err := a.service.PersistArtifact(r.Context(), r.PathValue("id"), body.RequestID, body.Direction, body.Kind, body.Filename, body.ContentType, raw)
	if err != nil {
		writeArtifactMutationError(w, "artifact_persist_failed", err)
		return
	}
	writeJSON(w, http.StatusCreated, record)
}

func (a *API) artifactDownload(w http.ResponseWriter, r *http.Request) {
	record, raw, err := a.service.ReadArtifact(r.Context(), r.PathValue("id"), r.PathValue("artifact_id"))
	if err != nil {
		writeError(w, http.StatusNotFound, "artifact_missing", err.Error())
		return
	}
	if r.URL.Query().Get("office") == "1" || r.URL.Query().Get("preview") == "office" {
		preview, previewErr := documentpreview.OfficeText(record.Name, raw)
		if previewErr != nil {
			writeError(w, http.StatusUnprocessableEntity, "office_preview_unavailable", previewErr.Error())
			return
		}
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Header().Set("Cache-Control", "private, no-store")
		_, _ = io.WriteString(w, preview)
		return
	}
	contentType := record.ContentType
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	w.Header().Set("Content-Type", contentType)
	disposition := "attachment"
	if r.URL.Query().Get("preview") == "1" {
		disposition = "inline"
	}
	w.Header().Set("Content-Disposition", disposition+`; filename="`+strings.ReplaceAll(record.Name, `"`, "")+`"`)
	w.Header().Set("Content-Length", fmt.Sprintf("%d", len(raw)))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(raw)
}

func (a *API) artifactEntries(w http.ResponseWriter, r *http.Request) {
	entries, err := a.service.ArtifactEntries(r.Context(), r.PathValue("id"), r.PathValue("artifact_id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "artifact_not_explorable", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"entries": entries})
}

func (a *API) artifactEntry(w http.ResponseWriter, r *http.Request) {
	data, name, err := a.service.ReadArtifactEntry(r.Context(), r.PathValue("id"), r.PathValue("artifact_id"), r.URL.Query().Get("path"))
	if err != nil {
		writeError(w, http.StatusNotFound, "artifact_entry_missing", err.Error())
		return
	}
	if r.URL.Query().Get("download") == "1" {
		w.Header().Set("Content-Disposition", `attachment; filename="`+strings.ReplaceAll(name, `"`, "")+`"`)
	}
	if r.URL.Query().Get("office") == "1" || r.URL.Query().Get("preview") == "office" {
		preview, previewErr := documentpreview.OfficeText(name, data)
		if previewErr != nil {
			writeError(w, http.StatusUnprocessableEntity, "office_preview_unavailable", previewErr.Error())
			return
		}
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Header().Set("Cache-Control", "private, no-store")
		_, _ = io.WriteString(w, preview)
		return
	}
	contentType := mime.TypeByExtension(strings.ToLower(filepath.Ext(name)))
	if contentType == "" {
		contentType = http.DetectContentType(data)
	}
	w.Header().Set("Content-Type", contentType)
	applyPreviewSecurityHeaders(w, contentType)
	http.ServeContent(w, r, name, time.Time{}, bytes.NewReader(data))
}

func (a *API) storage(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, a.service.StorageUsage())
}

func (a *API) pruneStorage(w http.ResponseWriter, _ *http.Request) {
	tempRoot := app.CheckoutTemporaryRoot(a.cfg.StateFile, os.TempDir())
	result, err := a.service.ReclaimObsoleteStorage(tempRoot, a.cfg.DependencyCacheDir, time.Now().UTC().Add(-app.ObsoleteStorageGrace))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "storage_prune_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

// selfEvolutionBlock reports the fail-closed transaction holding the
// self-evolution lock, so an operator can see what is waiting for them instead
// of only being refused.
func (a *API) selfEvolutionBlock(w http.ResponseWriter, _ *http.Request) {
	block, blocked := a.service.SelfEvolutionBlocked()
	if !blocked {
		writeJSON(w, http.StatusOK, map[string]any{"blocked": false})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"blocked": true, "block": block})
}

// releaseSelfEvolutionBlock is an explicit human action, never reachable from a
// model plan: it frees a lock a fail-closed transaction is deliberately holding.
// The transaction must be named, so releasing is always an acknowledgement of a
// specific state rather than a blanket reset.
func (a *API) releaseSelfEvolutionBlock(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Transaction string `json:"transaction"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	released, err := a.service.ReleaseSelfEvolutionBlock(body.Transaction)
	if err != nil {
		writeError(w, http.StatusBadRequest, "self_evolution_release_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"released": released})
}

func (a *API) clearStorage(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Confirm string `json:"confirm"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if err := app.ValidateStorageClearConfirmation(body.Confirm); err != nil {
		writeError(w, http.StatusBadRequest, "storage_clear_confirmation_required", "type APAGAR WHARNEX to confirm complete Wharnex data removal")
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
		ProjectPath     string                 `json:"project_path"`
		ExecutionMode   domain.ExecutionMode   `json:"execution_mode"`
		AutomationMode  domain.AutomationMode  `json:"automation_mode"`
		EffortLevel     domain.EffortLevel     `json:"effort_level"`
		ReasoningEffort domain.ReasoningEffort `json:"reasoning_effort"`
		ChatID          string                 `json:"chat_id"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if strings.TrimSpace(body.ProjectPath) == "" {
		writeError(w, http.StatusBadRequest, "invalid_project_path", "project_path is required")
		return
	}
	if body.ReasoningEffort != "" && !domain.ValidReasoningEffort(body.ReasoningEffort) {
		writeError(w, http.StatusBadRequest, "reasoning_effort_failed", fmt.Sprintf("unsupported reasoning effort %q", body.ReasoningEffort))
		return
	}
	item, err := a.service.StartSessionWithModes(r.Context(), body.ProjectPath, body.ExecutionMode, body.AutomationMode, body.EffortLevel)
	if err != nil {
		writeError(w, http.StatusBadRequest, "session_create_failed", err.Error())
		return
	}
	if strings.TrimSpace(body.ChatID) != "" {
		if withChat, chatErr := a.service.SetChatID(item.ID, body.ChatID); chatErr == nil {
			item = withChat
		}
	}
	if body.ReasoningEffort != "" {
		if withEffort, effortErr := a.service.SetReasoningEffort(item.ID, body.ReasoningEffort); effortErr != nil {
			writeError(w, http.StatusBadRequest, "reasoning_effort_failed", effortErr.Error())
			return
		} else {
			item = withEffort
		}
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

// chatID backfills Session.ChatID for a session that predates chat-id
// propagation (or otherwise never received one at creation): the frontend
// always knows its own real chat id, so it can call this once it notices
// session.chat_id is empty. Without a real chat id, every derived-request
// bundle filename falls back to the "system" placeholder, which will never
// match the frontend's actual active chat and permanently fails bundle
// validation for that session (a session created before this endpoint
// existed would otherwise never recover).
func (a *API) chatID(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ChatID string `json:"chat_id"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	item, err := a.service.SetChatID(r.PathValue("id"), body.ChatID)
	if err != nil {
		writeError(w, http.StatusBadRequest, "chat_id_failed", err.Error())
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

func (a *API) debugMode(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Enabled bool `json:"enabled"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	item, err := a.service.SetDebugEnabled(r.PathValue("id"), body.Enabled)
	if err != nil {
		writeError(w, http.StatusBadRequest, "debug_mode_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (a *API) approveDebug(w http.ResponseWriter, r *http.Request) {
	result, err := a.service.ApproveDebug(r.Context(), r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "debug_approval_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (a *API) effortLevel(w http.ResponseWriter, r *http.Request) {
	var body struct {
		EffortLevel domain.EffortLevel `json:"effort_level"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	item, err := a.service.SetEffortLevel(r.PathValue("id"), body.EffortLevel)
	if err != nil {
		writeError(w, http.StatusBadRequest, "effort_level_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (a *API) reasoningEffort(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ReasoningEffort domain.ReasoningEffort `json:"reasoning_effort"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	item, err := a.service.SetReasoningEffort(r.PathValue("id"), body.ReasoningEffort)
	if err != nil {
		writeError(w, http.StatusBadRequest, "reasoning_effort_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (a *API) chatTransportMode(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ChatTransportMode domain.ChatTransportMode `json:"chat_transport_mode"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	item, err := a.service.SetChatTransportMode(r.PathValue("id"), body.ChatTransportMode)
	if err != nil {
		writeError(w, http.StatusBadRequest, "chat_transport_mode_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (a *API) knowledgeSharing(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Enabled bool `json:"enabled"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	item, err := a.service.SetKnowledgeSharingEnabled(r.PathValue("id"), body.Enabled)
	if err != nil {
		writeError(w, http.StatusBadRequest, "knowledge_sharing_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (a *API) approvePlan(w http.ResponseWriter, r *http.Request) {
	result, item, err := a.service.SubmitPlanApproval(r.Context(), r.PathValue("id"), r.PathValue("request_id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "plan_approval_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"session": item, "turn": result.Turn, "plan": result.Plan, "manual_prompt": result.ManualPrompt})
}

func (a *API) correctPlan(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Guidance string `json:"guidance"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	result, item, err := a.service.SubmitPlanCorrection(r.Context(), r.PathValue("id"), r.PathValue("request_id"), body.Guidance)
	if err != nil {
		writeError(w, http.StatusBadRequest, "plan_correction_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"session": item, "turn": result.Turn, "plan": result.Plan, "manual_prompt": result.ManualPrompt})
}

func (a *API) rejectPlan(w http.ResponseWriter, r *http.Request) {
	item, err := a.service.RejectPlan(r.PathValue("id"), r.PathValue("request_id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "plan_rejection_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (a *API) adjustExecutionPlan(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Guidance string `json:"guidance"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	result, item, err := a.service.SubmitExecutionPlanAdjustment(r.Context(), r.PathValue("id"), body.Guidance)
	if err != nil {
		writeError(w, http.StatusBadRequest, "execution_plan_adjustment_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"session": item, "turn": result.Turn, "plan": result.Plan, "manual_prompt": result.ManualPrompt})
}

func (a *API) rejectExecutionPlan(w http.ResponseWriter, r *http.Request) {
	item, err := a.service.RejectExecutionPlan(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "execution_plan_rejection_failed", err.Error())
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

func (a *API) composerBundlePreview(w http.ResponseWriter, r *http.Request) {
	var body app.ComposerBundlePreviewRequest
	decoder := json.NewDecoder(io.LimitReader(r.Body, 150<<20))
	if err := decoder.Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_bundle_preview", err.Error())
		return
	}
	record, err := a.service.PreviewComposerBundle(r.Context(), r.PathValue("id"), body)
	if err != nil {
		status := http.StatusBadRequest
		if errors.Is(err, session.ErrNotFound) {
			status = http.StatusNotFound
		}
		writeError(w, status, "bundle_preview_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, record)
}

func (a *API) remoteInput(w http.ResponseWriter, r *http.Request) {
	if !a.service.RemoteInputStatus().Enabled {
		writeError(w, http.StatusConflict, "remote_storage_disabled", "remote storage is not configured")
		return
	}
	var body app.RemoteInputRequest
	decoder := json.NewDecoder(io.LimitReader(r.Body, 150<<20))
	if err := decoder.Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_remote_input", err.Error())
		return
	}
	if len(body.TunnelInstanceIDs) > 0 {
		document, err := config.ReadTunnelDocument(a.cfg.Tunnel)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "tunnel_config_read_failed", err.Error())
			return
		}
		body.TunnelInstanceIDs = configuredTunnelInstanceIDs(document, body.TunnelInstanceIDs)
		if len(body.TunnelInstanceIDs) == 0 {
			writeError(w, http.StatusConflict, "tunnel_selection_stale", "none of the selected tunnels remains configured")
			return
		}
	}
	result, err := a.service.PublishRemoteInput(r.Context(), r.PathValue("id"), body)
	if err != nil {
		status := http.StatusBadRequest
		if errors.Is(err, session.ErrNotFound) {
			status = http.StatusNotFound
		}
		writeError(w, status, "remote_input_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, result)
}

func (a *API) remoteInputEvent(w http.ResponseWriter, r *http.Request) {
	var body struct {
		RequestID string `json:"request_id"`
		Comment   string `json:"comment"`
	}
	decoder := json.NewDecoder(io.LimitReader(r.Body, (20<<10)+1))
	if err := decoder.Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_remote_input_event", err.Error())
		return
	}
	if err := a.service.NotifyRemoteInputChannel(r.PathValue("id"), body.RequestID, body.Comment); err != nil {
		writeError(w, http.StatusConflict, "remote_input_event_rejected", err.Error())
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"accepted": true})
}

func (a *API) remoteInputFailure(w http.ResponseWriter, r *http.Request) {
	var body struct {
		RequestID string `json:"request_id"`
		Reason    string `json:"reason"`
		Kind      string `json:"kind"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	item, err := a.service.FailRemoteInputRequestWithKind(r.Context(), r.PathValue("id"), body.RequestID, body.Reason, body.Kind)
	if err != nil {
		writeError(w, http.StatusConflict, "remote_input_failure_rejected", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, item)
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
		if errors.Is(err, app.ErrExecutionBundleRequestMismatch) {
			writeError(w, http.StatusConflict, "execution_bundle_request_mismatch", err.Error())
			return
		}
		if errors.Is(err, app.ErrExecutionBundleNotPending) {
			writeError(w, http.StatusConflict, "execution_bundle_not_pending", err.Error())
			return
		}
		if errors.Is(err, app.ErrSubmoduleWrite) {
			writeError(w, http.StatusBadRequest, "execution_bundle_submodule_write", err.Error())
			return
		}
		writeError(w, http.StatusBadRequest, "invalid_execution_bundle", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (a *API) retryPolicyRepair(w http.ResponseWriter, r *http.Request) {
	item, err := a.service.RetryPolicyRepair(r.Context(), r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusConflict, "policy_repair_unavailable", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (a *API) requestFailureRepair(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Detail string `json:"detail"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil && !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, "invalid_failure_repair", "request body must be valid JSON")
		return
	}
	item, err := a.service.RequestFailureRepair(r.Context(), r.PathValue("id"), body.Detail)
	if err != nil {
		writeError(w, http.StatusConflict, "failure_repair_unavailable", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (a *API) retryFailedRequest(w http.ResponseWriter, r *http.Request) {
	item, err := a.service.RetryFailedRequest(r.Context(), r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusConflict, "failed_request_retry_unavailable", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, item)
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

func (a *API) retryDependencyNetwork(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Approved bool `json:"approved"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	item, err := a.service.RetryDependencyNetwork(r.Context(), r.PathValue("id"), body.Approved)
	if err != nil {
		status := http.StatusConflict
		if errors.Is(err, app.ErrApprovalRequired) {
			status = http.StatusForbidden
		}
		writeJSON(w, status, map[string]any{"error": map[string]any{"code": "dependency_network_retry_failed", "message": err.Error()}, "session": item})
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (a *API) retryHostDependencyRepair(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Approved bool `json:"approved"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	item, err := a.service.RetryHostDependencyRepair(r.Context(), r.PathValue("id"), body.Approved)
	if err != nil {
		status := http.StatusConflict
		if errors.Is(err, app.ErrApprovalRequired) {
			status = http.StatusForbidden
		}
		writeJSON(w, status, map[string]any{"error": map[string]any{"code": "host_dependency_repair_failed", "message": err.Error()}, "session": item})
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (a *API) cancelInteractive(w http.ResponseWriter, r *http.Request) {
	if !a.service.CancelInteractiveV2(r.PathValue("id")) {
		writeError(w, http.StatusConflict, "interactive_cancel_unavailable", "no interactive v2 round is running")
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]bool{"cancelled": true})
}

func (a *API) resumeInterruptedExecution(w http.ResponseWriter, r *http.Request) {
	result, err := a.service.ResumeInterruptedExecution(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusConflict, "execution_recovery_unavailable", err.Error())
		return
	}
	writeJSON(w, http.StatusAccepted, result)
}

func (a *API) discardInterruptedExecution(w http.ResponseWriter, r *http.Request) {
	item, err := a.service.DiscardInterruptedExecution(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusConflict, "execution_recovery_unavailable", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (a *API) cancelPendingRequest(w http.ResponseWriter, r *http.Request) {
	var body struct {
		RequestID string `json:"request_id"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	item, err := a.service.CancelPendingRequestByID(r.PathValue("id"), body.RequestID)
	if err != nil {
		writeError(w, http.StatusConflict, "request_cancel_unavailable", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (a *API) apply(w http.ResponseWriter, r *http.Request) {
	item, err := a.service.ApplyToHost(r.Context(), r.PathValue("id"))
	if err != nil {
		// A conflict already has its own resolution path, and a conflict confined
		// to Wharnex-managed state has no planner-resolvable content at all —
		// starting a repair round for either just spends a request on something
		// the model cannot fix.
		if !errors.Is(err, app.ErrIntegrationConflict) && !errors.Is(err, app.ErrManagedStateConflict) {
			// A host build may outlive the browser/proxy request that initiated
			// Apply. Its rollback already completed, so losing the request context
			// must not also lose the durable recovery transition and strand the
			// verified candidate. Bound recovery independently of client lifetime.
			recoveryCtx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), 60*time.Second)
			_, _ = a.service.TriggerApplyFailureRepair(recoveryCtx, r.PathValue("id"), err)
			cancel()
		}
		writeError(w, 409, "apply_failed", err.Error())
		return
	}
	writeJSON(w, 200, item)
}

func (a *API) rejectPendingChanges(w http.ResponseWriter, r *http.Request) {
	item, err := a.service.RejectPendingHostChanges(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusConflict, "pending_changes_reject_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (a *API) revert(w http.ResponseWriter, r *http.Request) {
	item, err := a.service.RevertHostChange(r.Context(), r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusConflict, "revert_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (a *API) restoreReverted(w http.ResponseWriter, r *http.Request) {
	item, err := a.service.RestoreRevertedHostChange(r.Context(), r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusConflict, "restore_reverted_failed", err.Error())
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

func (a *API) selfEvolutionEvidence(w http.ResponseWriter, r *http.Request) {
	evidence, err := a.service.EvolutionEvidence(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusForbidden, "self_evolution_evidence_unavailable", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, evidence)
}

func (a *API) selfEvolutionAnalyze(w http.ResponseWriter, r *http.Request) {
	var body struct {
		EvidenceIDs []string `json:"evidence_ids"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	item, evidence, err := a.service.PrepareEvolutionAnalysis(r.Context(), r.PathValue("id"), body.EvidenceIDs...)
	if err != nil {
		writeError(w, http.StatusConflict, "self_evolution_analysis_unavailable", err.Error())
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"session": item, "evidence_total": evidence.Total})
}

func (a *API) selfEvolutionResolveEvidence(w http.ResponseWriter, r *http.Request) {
	var body struct {
		EvidenceIDs []string `json:"evidence_ids"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	evidence, err := a.service.ResolveEvolutionEvidence(r.PathValue("id"), body.EvidenceIDs)
	if err != nil {
		writeError(w, http.StatusConflict, "self_evolution_evidence_resolve_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, evidence)
}

// maxHistoryEvents bounds every catch-up replay of a session's event ledger,
// for the REST history endpoint and for the SSE stream alike. The durable
// ledger is deliberately unbounded (see AGENTS.md §3), but a catch-up is a
// live client's starting picture, not the record: an unbounded one made every
// SSE connect replay the whole ledger of a long-lived session as a single
// burst - 3159 frames / 4.7 MB measured on one ordinary session here - which
// the renderer has to absorb before it can paint anything at all.
const maxHistoryEvents = 2000

func (a *API) executionErrors(w http.ResponseWriter, r *http.Request) {
	items, err := a.service.ExecutionErrors(r.PathValue("id"))
	if err != nil {
		if errors.Is(err, session.ErrNotFound) {
			writeError(w, http.StatusNotFound, "session_not_found", err.Error())
			return
		}
		writeError(w, http.StatusInternalServerError, "execution_errors_read_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"errors": items})
}

func (a *API) eventHistory(w http.ResponseWriter, r *http.Request) {
	events := a.bus.History(r.PathValue("id"))
	total := len(events)
	truncated := total > maxHistoryEvents
	if truncated {
		events = events[total-maxHistoryEvents:]
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"events": events, "total": total, "truncated": truncated,
	})
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
	history := a.bus.History(r.PathValue("id"))
	if len(history) > maxHistoryEvents {
		history = history[len(history)-maxHistoryEvents:]
	}
	for _, event := range history {
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

func (a *API) relatedProjects(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ProjectPaths []string `json:"project_paths"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	item, err := a.service.SetRelatedProjects(r.Context(), r.PathValue("id"), body.ProjectPaths)
	if err != nil {
		writeError(w, http.StatusBadRequest, "related_projects_failed", err.Error())
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

func (a *API) previewFile(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Query().Get("path")
	handle, info, err := a.service.OpenFilePreview(r.PathValue("id"), path)
	if err != nil {
		writeError(w, http.StatusBadRequest, "file_preview_failed", err.Error())
		return
	}
	defer handle.Close()
	if r.URL.Query().Get("preview") == "office" {
		if info.Size() > 64<<20 {
			writeError(w, http.StatusRequestEntityTooLarge, "office_preview_too_large", "office document exceeds 64 MiB preview limit")
			return
		}
		raw, readErr := io.ReadAll(io.LimitReader(handle, (64<<20)+1))
		if readErr != nil {
			writeError(w, http.StatusInternalServerError, "office_preview_read_failed", readErr.Error())
			return
		}
		preview, previewErr := documentpreview.OfficeText(info.Name(), raw)
		if previewErr != nil {
			writeError(w, http.StatusUnprocessableEntity, "office_preview_unavailable", previewErr.Error())
			return
		}
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Header().Set("Cache-Control", "private, no-store")
		_, _ = io.WriteString(w, preview)
		return
	}
	contentType := mime.TypeByExtension(strings.ToLower(filepath.Ext(info.Name())))
	if contentType != "" {
		w.Header().Set("Content-Type", contentType)
	}
	applyPreviewSecurityHeaders(w, contentType)
	http.ServeContent(w, r, info.Name(), info.ModTime(), handle)
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
	item, err := a.service.EnsureContextArtifacts(r.PathValue("id"))
	if err != nil {
		if errors.Is(err, session.ErrNotFound) {
			writeError(w, 404, "session_not_found", "session not found")
		} else {
			writeError(w, 500, "context_rebuild_failed", err.Error())
		}
		return
	}
	serveDownload(w, r, item.Context.ZipPath, "wharness-context-"+item.ID+".zip", "application/zip")
}
func (a *API) contextMaps(w http.ResponseWriter, r *http.Request) {
	maps, err := a.service.RequestContextMaps(r.PathValue("id"))
	if err != nil {
		if errors.Is(err, session.ErrNotFound) {
			writeError(w, http.StatusNotFound, "session_not_found", "session not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "context_maps_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, maps)
}

func (a *API) contextInspection(w http.ResponseWriter, r *http.Request) {
	inspection, err := a.service.ContextInspection(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "context_inspection_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, inspection)
}

// attachmentInspection previews one `@attach` marker exactly as a request would
// resolve it, so the panel that configures a selection and the request that
// sends it can never disagree about what it means.
func (a *API) attachmentInspection(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Marker string `json:"marker"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	inspection, err := a.service.InspectAttachment(r.PathValue("id"), body.Marker)
	if err != nil {
		if errors.Is(err, contextbundle.ErrAttachmentDenied) {
			writeError(w, http.StatusForbidden, "attachment_denied", err.Error())
			return
		}
		writeError(w, http.StatusBadRequest, "attachment_inspection_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, inspection)
}

func (a *API) referenceInspection(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Marker string `json:"marker"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	inspection, err := a.service.InspectReference(r.PathValue("id"), body.Marker)
	if err != nil {
		writeError(w, http.StatusBadRequest, "reference_inspection_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, inspection)
}

// knownProjects answers the composer's `@ref` menu with exactly the candidate
// set the engine will resolve a reference against at submit time — every
// project Wharnex has worked on before, open or closed, this session's own
// project excluded. See Service.KnownProjects.
func (a *API) knownProjects(w http.ResponseWriter, r *http.Request) {
	known, err := a.service.KnownProjects(r.PathValue("id"))
	if err != nil {
		if errors.Is(err, session.ErrNotFound) {
			writeError(w, 404, "session_not_found", "session not found")
			return
		}
		writeError(w, 500, "known_projects_failed", err.Error())
		return
	}
	if known == nil {
		known = []domain.KnownProjectRef{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"projects": known})
}

func (a *API) contextFile(w http.ResponseWriter, r *http.Request) {
	item, err := a.service.EnsureContextArtifacts(r.PathValue("id"))
	if err != nil {
		if errors.Is(err, session.ErrNotFound) {
			writeError(w, 404, "session_not_found", "session not found")
		} else {
			writeError(w, 500, "context_rebuild_failed", err.Error())
		}
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

// writeJSONError carries structured data alongside the error envelope, for a
// refusal the client must act on rather than merely display — a blocked
// selective commit has to name the records that must be included.
func writeJSONError(w http.ResponseWriter, status int, code, message string, detail any) {
	writeJSON(w, status, map[string]any{
		"error":  map[string]string{"code": code, "message": message},
		"detail": detail,
	})
}
func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func cors(next http.Handler, allowed []string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		for _, candidate := range allowed {
			if origin == candidate {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Vary", "Origin")
				break
			}
		}
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.Header().Set("Access-Control-Expose-Headers", "Content-Disposition")
		w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
