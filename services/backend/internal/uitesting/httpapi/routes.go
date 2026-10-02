package httpapi

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/session"
	"kernl.local/harness/backend/internal/uitesting"
)

type Routes struct {
	sessions *session.Store
	store    *uitesting.Store
}

func New(sessions *session.Store, stateDir string) (*Routes, error) {
	store, err := uitesting.NewStore(filepath.Join(stateDir, "ui-testing"))
	if err != nil {
		return nil, err
	}
	return &Routes{sessions: sessions, store: store}, nil
}

func (h *Routes) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/sessions/{id}/ui-testing", h.get)
	mux.HandleFunc("POST /api/sessions/{id}/ui-testing/sync", h.sync)
	mux.HandleFunc("PUT /api/sessions/{id}/ui-testing/config", h.configure)
	mux.HandleFunc("POST /api/sessions/{id}/ui-testing/run", h.run)
	mux.HandleFunc("POST /api/ui-testing/tasks/{id}/discovery", h.discovery)
	mux.HandleFunc("POST /api/ui-testing/tasks/{id}/credential", h.credential)
	mux.HandleFunc("POST /api/ui-testing/tasks/{id}/result", h.result)
	mux.HandleFunc("GET /api/sessions/{id}/ui-testing/assets/{run}/{name}", h.asset)
}

func (h *Routes) get(w http.ResponseWriter, r *http.Request) {
	item, err := h.sessions.Get(r.PathValue("id"))
	if err != nil {
		writeErr(w, http.StatusNotFound, err)
		return
	}
	doc, err := h.store.Load(item.ProjectPath)
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	doc, err = h.reconcileSyncTask(item.ProjectPath, doc)
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	writeJSON(w, 200, doc)
}

func (h *Routes) reconcileSyncTask(project string, doc uitesting.Document) (uitesting.Document, error) {
	if doc.SyncStatus != "syncing" || strings.TrimSpace(doc.SyncTaskID) == "" {
		return doc, nil
	}
	task, err := h.sessions.GetChatAgentTask(doc.SyncTaskID)
	if errors.Is(err, session.ErrChatAgentTaskNotFound) {
		return h.store.FailSync(project, doc.SyncTaskID, "A tarefa de sincronização já não está disponível. Tente sincronizar novamente.")
	}
	if err != nil {
		return doc, err
	}
	var detail string
	switch task.Status {
	case session.ChatAgentTaskFailed, session.ChatAgentTaskAttention, session.ChatAgentTaskCancelled:
		detail = strings.TrimSpace(task.LastError)
		if detail == "" {
			detail = "A sincronização do UI Lab terminou sem concluir a descoberta."
		}
	case session.ChatAgentTaskDone:
		detail = "A tarefa de sincronização terminou sem guardar o catálogo de testes. Tente sincronizar novamente."
	default:
		return doc, nil
	}
	return h.store.FailSync(project, doc.SyncTaskID, detail)
}

func (h *Routes) sync(w http.ResponseWriter, r *http.Request) {
	item, err := h.sessions.Get(r.PathValue("id"))
	if err != nil {
		writeErr(w, 404, err)
		return
	}
	archivePath := strings.TrimSpace(item.Context.ZipPath)
	if archivePath == "" && item.LastRequestID != "" {
		archivePath = item.RequestContextArchives[item.LastRequestID]
	}
	raw, err := os.ReadFile(archivePath)
	if err != nil {
		writeErr(w, 409, fmt.Errorf("project context archive is unavailable: %w", err))
		return
	}
	if len(raw) > 48<<20 {
		writeErr(w, 413, errors.New("project context archive exceeds 48 MiB"))
		return
	}
	taskID := session.NewChatAgentTaskID()
	manifest, requestBundle, err := uitesting.BuildDiscoveryRequest(taskID, item.Context.Manifest.SHA256, raw, uitesting.DiscoveryRequestMetadata{
		ChatTitle: "Descobrir testes UI", ChatID: item.ChatID, ChatHash: item.Context.Manifest.SHA256, RequestedAt: time.Now().UTC().Format(time.RFC3339Nano),
	})
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	payload, _ := json.Marshal(discoveryTaskPayload{
		Protocol: uitesting.DiscoveryRequestProtocolV1, Request: manifest,
		Bootstrap: uitesting.DiscoveryRequestBootstrap(manifest), ArchiveBase64: base64.StdEncoding.EncodeToString(requestBundle),
	})
	task, err := h.sessions.EnqueueChatAgentTask(session.ChatAgentTask{TaskID: taskID, Type: "UI_TEST_DISCOVER", ProjectID: item.ProjectPath, SessionID: item.ID, ChatID: taskID, RequestID: taskID, RootRequestID: taskID, DedupeKey: "ui-discovery:" + item.ProjectPath + ":" + item.Context.Manifest.SHA256, Payload: payload, MaxAttempts: 3, NotBefore: time.Now().UTC(), Title: "Descobrir testes UI", Description: "Gerar catálogo de ambientes e testes a partir do contexto completo do projeto."})
	if err != nil {
		writeErr(w, 409, err)
		return
	}
	doc, err := h.store.SetSyncing(item.ProjectPath, task.TaskID)
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	writeJSON(w, http.StatusAccepted, doc)
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func writeErr(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, map[string]string{"error": err.Error()})
}
