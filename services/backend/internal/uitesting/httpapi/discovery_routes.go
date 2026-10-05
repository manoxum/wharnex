package httpapi

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/session"
	"kernl.local/harness/backend/internal/uitesting"
)

type designInput struct {
	Brief         string `json:"brief"`
	EnvironmentID string `json:"environment_id"`
}

func (h *Routes) sync(w http.ResponseWriter, r *http.Request) {
	item, err := h.sessions.Get(r.PathValue("id"))
	if err != nil {
		writeErr(w, 404, err)
		return
	}
	task, status, err := h.enqueueDiscovery(item, uitesting.DiscoveryTask, designInput{})
	if err != nil {
		writeErr(w, status, err)
		return
	}
	doc, err := h.store.SetSyncing(item.ProjectPath, task.TaskID)
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	writeJSON(w, http.StatusAccepted, doc)
}

func (h *Routes) design(w http.ResponseWriter, r *http.Request) {
	item, err := h.sessions.Get(r.PathValue("id"))
	if err != nil {
		writeErr(w, 404, err)
		return
	}
	var input designInput
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&input) != nil {
		writeErr(w, 400, errors.New("invalid UI test design request"))
		return
	}
	input.Brief = strings.TrimSpace(input.Brief)
	if input.Brief == "" || len(input.Brief) > uitesting.MaxDesignBrief {
		writeErr(w, 400, fmt.Errorf("describe the test in 1 to %d characters", uitesting.MaxDesignBrief))
		return
	}
	task, status, err := h.enqueueDiscovery(item, uitesting.DesignTask, input)
	if err != nil {
		writeErr(w, status, err)
		return
	}
	doc, err := h.store.Load(item.ProjectPath)
	if err == nil && !hasDesign(doc, task.TaskID) {
		doc, err = h.store.BeginDesign(item.ProjectPath, uitesting.DesignRequest{TaskID: task.TaskID, Brief: input.Brief, EnvironmentID: input.EnvironmentID})
	}
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	writeJSON(w, http.StatusAccepted, doc)
}

func (h *Routes) dismissDesign(w http.ResponseWriter, r *http.Request) {
	item, err := h.sessions.Get(r.PathValue("id"))
	if err != nil {
		writeErr(w, 404, err)
		return
	}
	doc, err := h.store.DismissDesign(item.ProjectPath, r.PathValue("task"))
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	writeJSON(w, 200, doc)
}

// enqueueDiscovery builds a v2 request bundle — project context, the whole
// current catalog and, for a design, the operator's brief — and queues it.
func (h *Routes) enqueueDiscovery(item domain.Session, task string, input designInput) (session.ChatAgentTask, int, error) {
	archivePath := strings.TrimSpace(item.Context.ZipPath)
	if archivePath == "" && item.LastRequestID != "" {
		archivePath = item.RequestContextArchives[item.LastRequestID]
	}
	raw, err := os.ReadFile(archivePath)
	if err != nil && h.refresh != nil {
		if refreshed, refreshErr := h.refresh(item.ID); refreshErr == nil {
			item = refreshed
			raw, err = os.ReadFile(strings.TrimSpace(item.Context.ZipPath))
		}
	}
	if err != nil {
		return session.ChatAgentTask{}, 409, fmt.Errorf("project context archive is unavailable: %w", err)
	}
	if len(raw) > 48<<20 {
		return session.ChatAgentTask{}, 413, errors.New("project context archive exceeds 48 MiB")
	}
	doc, err := h.store.Load(item.ProjectPath)
	if err != nil {
		return session.ChatAgentTask{}, 500, err
	}
	taskID := session.NewChatAgentTaskID()
	title, description, dedupe := "Descobrir testes UI", "Completar o catálogo de testes a partir do projeto e do catálogo atual.", "ui-discovery:"+item.ProjectPath+":"+item.Context.Manifest.SHA256
	if task == uitesting.DesignTask {
		digest := sha256.Sum256([]byte(input.EnvironmentID + "\x00" + input.Brief))
		title, description, dedupe = "Desenhar teste UI", truncateText(input.Brief, 240), "ui-design:"+item.ProjectPath+":"+hex.EncodeToString(digest[:12])
	}
	manifest, bundle, err := uitesting.BuildDiscoveryRequestV2(uitesting.DiscoveryInput{
		TaskID: taskID, Task: task, ContextSHA256: item.Context.Manifest.SHA256, ContextArchive: raw,
		Catalog: uitesting.NewCatalogInput(doc), Brief: input.Brief, EnvironmentID: input.EnvironmentID,
		Metadata: uitesting.DiscoveryRequestMetadata{ChatTitle: title, ChatID: item.ChatID, ChatHash: item.Context.Manifest.SHA256, RequestedAt: time.Now().UTC().Format(time.RFC3339Nano)},
	})
	if err != nil {
		return session.ChatAgentTask{}, 400, err
	}
	payload, _ := json.Marshal(discoveryTaskPayload{
		Protocol: manifest.Protocol, Request: manifest,
		Bootstrap: uitesting.DiscoveryRequestBootstrap(manifest), ArchiveBase64: base64.StdEncoding.EncodeToString(bundle),
	})
	queued, err := h.sessions.EnqueueChatAgentTask(session.ChatAgentTask{TaskID: taskID, Type: "UI_TEST_DISCOVER", ProjectID: item.ProjectPath, SessionID: item.ID, ChatID: taskID, RequestID: taskID, RootRequestID: taskID, DedupeKey: dedupe, Payload: payload, MaxAttempts: 3, NotBefore: time.Now().UTC(), Title: title, Description: description})
	if err != nil {
		return session.ChatAgentTask{}, 409, err
	}
	return queued, 0, nil
}

func hasDesign(doc uitesting.Document, taskID string) bool {
	for _, design := range doc.Designs {
		if design.TaskID == taskID {
			return true
		}
	}
	return false
}

func truncateText(value string, limit int) string {
	if len(value) <= limit {
		return value
	}
	return value[:limit] + "…"
}
