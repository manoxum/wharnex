package httpapi

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/session"
)

const remoteDispatchBodyLimit = 80 << 20

type remotePromptAttachment struct {
	Name          string `json:"name"`
	MIME          string `json:"mime"`
	ContentBase64 string `json:"contentBase64"`
}

type remoteDispatchRequest struct {
	RequestID         string                   `json:"request_id"`
	WorkspaceChatID   string                   `json:"workspace_chat_id"`
	BootstrapText     string                   `json:"bootstrap_text"`
	ChatTitle         string                   `json:"chat_title"`
	ConversationURL   string                   `json:"conversation_url"`
	Attachments       []remotePromptAttachment `json:"attachments"`
	ProjectFiles      []string                 `json:"project_files"`
	TunnelInstanceIDs []string                 `json:"tunnel_instance_ids"`
	IncludeContext    bool                     `json:"include_context"`
}

func (a *API) remoteDispatch(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("X-Wharnex-Remote") != "1" {
		writeError(w, http.StatusForbidden, "remote_dispatch_remote_only", "remote dispatch is only available through the paired remote listener")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, remoteDispatchBodyLimit)
	var body remoteDispatchRequest
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "remote_dispatch_invalid", err.Error())
		return
	}
	item, err := a.store.Get(r.PathValue("id"))
	if err != nil {
		status := http.StatusConflict
		if errors.Is(err, session.ErrNotFound) {
			status = http.StatusNotFound
		}
		writeError(w, status, "remote_dispatch_session", err.Error())
		return
	}
	task, err := buildRemotePromptTask(item, body, time.Now().UTC())
	if err != nil {
		writeError(w, http.StatusConflict, "remote_dispatch_invalid", err.Error())
		return
	}
	saved, err := a.store.EnqueueChatAgentTask(task)
	if err != nil {
		writeChatAgentTaskError(w, err)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"queued": true, "task": saved})
}

func buildRemotePromptTask(item domain.Session, body remoteDispatchRequest, now time.Time) (session.ChatAgentTask, error) {
	requestID := strings.TrimSpace(body.RequestID)
	if requestID == "" || requestID != strings.TrimSpace(item.LastRequestID) {
		return session.ChatAgentTask{}, errors.New("request_id must match the session's active request")
	}
	prompt := strings.TrimSpace(item.LastManualPrompt)
	if prompt == "" {
		return session.ChatAgentTask{}, errors.New("the active request has no Desktop browser prompt to dispatch")
	}
	if !domain.AutomationModeIsAutomatic(item.AutomationMode) {
		return session.ChatAgentTask{}, errors.New("remote dispatch requires an automatic session so a Desktop Supervisor may submit it")
	}
	chatID := strings.TrimSpace(body.WorkspaceChatID)
	if chatID == "" {
		chatID = strings.TrimSpace(item.ChatID)
	}
	if chatID == "" {
		return session.ChatAgentTask{}, errors.New("workspace_chat_id is required")
	}
	if item.ChatID != "" && chatID != item.ChatID {
		return session.ChatAgentTask{}, errors.New("workspace_chat_id does not match the session chat binding")
	}
	attachments, err := normalizeRemoteAttachments(body.Attachments)
	if err != nil {
		return session.ChatAgentTask{}, err
	}
	projectFiles := normalizedRemoteStrings(body.ProjectFiles, 64)
	tunnelIDs := normalizedRemoteStrings(body.TunnelInstanceIDs, 16)
	request := map[string]any{
		"text": prompt, "bootstrapText": strings.TrimSpace(body.BootstrapText),
		"workspaceChatId": chatID, "sessionId": item.ID, "requestId": requestID,
		"projectPath": item.ProjectPath, "projectName": filepath.Base(item.ProjectPath),
		"chatTitle": strings.TrimSpace(body.ChatTitle), "url": strings.TrimSpace(body.ConversationURL),
		"attachments": attachments, "artifacts": []any{}, "projectFiles": projectFiles,
		"tunnelInstanceIds": tunnelIDs, "includeContext": body.IncludeContext,
		"reasoningEffort": string(item.ReasoningEffort), "requestedAt": now.Format(time.RFC3339Nano),
	}
	payload, err := json.Marshal(map[string]any{
		"operation": "PREPARE_PROMPT", "request": request,
		"workspace_chat_id": chatID, "conversation_url": strings.TrimSpace(body.ConversationURL),
	})
	if err != nil {
		return session.ChatAgentTask{}, err
	}
	return session.ChatAgentTask{
		Type: "BOT_WRITE", ProjectID: item.ProjectPath, ChatID: chatID, SessionID: item.ID,
		RequestID: requestID, RootRequestID: requestID, DedupeKey: "remote-prepare:" + requestID,
		Payload: payload, MaxAttempts: 6, NotBefore: now,
		Title: "Remote request dispatch", Description: "Submit the paired webapp request through a Desktop-owned ChatGPT Supervisor.",
	}, nil
}

func normalizeRemoteAttachments(values []remotePromptAttachment) ([]remotePromptAttachment, error) {
	if len(values) > 16 {
		return nil, errors.New("at most 16 remote attachments are allowed")
	}
	total := 0
	out := make([]remotePromptAttachment, 0, len(values))
	for _, value := range values {
		value.Name = strings.TrimSpace(value.Name)
		value.MIME = strings.TrimSpace(value.MIME)
		if value.Name == "" || len(value.Name) > 255 || strings.ContainsAny(value.Name, "/\\") {
			return nil, errors.New("remote attachment name is invalid")
		}
		decoded, err := base64.StdEncoding.DecodeString(value.ContentBase64)
		if err != nil {
			return nil, errors.New("remote attachment is not valid base64")
		}
		total += len(decoded)
		if total > 64<<20 {
			return nil, errors.New("remote attachments exceed 64 MiB")
		}
		out = append(out, value)
	}
	return out, nil
}

func normalizedRemoteStrings(values []string, limit int) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
		if len(out) >= limit {
			break
		}
	}
	return out
}
