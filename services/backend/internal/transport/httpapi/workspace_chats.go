package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"

	"kernl.local/harness/backend/internal/app"
	"kernl.local/harness/backend/internal/domain"
)

// HTTP surface for the workspace chat index and transcripts.
//
// The renderer owns chat identity and rewrites whole collections, so these are
// deliberately upsert/replace shaped rather than a CRUD dialect that would let
// the two representations drift apart.

const maxChatRequestBytes = 8 << 20

func (a *API) listWorkspaceChats(w http.ResponseWriter, r *http.Request) {
	chats, err := a.service.ListWorkspaceChats(r.URL.Query().Get("project_path"))
	if err != nil {
		writeWorkspaceChatError(w, err)
		return
	}
	if chats == nil {
		chats = []domain.WorkspaceChat{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"chats": chats})
}

func (a *API) saveWorkspaceChat(w http.ResponseWriter, r *http.Request) {
	var chat domain.WorkspaceChat
	if err := decodeChatBody(r, &chat); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	// The path is authoritative for identity: a body that disagrees would let
	// one chat be written under another chat's id.
	chat.ID = r.PathValue("id")
	saved, err := a.service.SaveWorkspaceChat(chat)
	if err != nil {
		writeWorkspaceChatError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, saved)
}

func (a *API) updateWorkspaceChatRemote(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ChatGPTURL       string `json:"chatgpt_url"`
		RemoteProjectRef string `json:"remote_project_ref"`
		RemoteTitle      string `json:"remote_title"`
		RemoteState      string `json:"remote_state"`
	}
	if err := decodeChatBody(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	if err := a.service.UpdateWorkspaceChatRemote(r.PathValue("id"), body.ChatGPTURL, body.RemoteProjectRef, body.RemoteTitle, body.RemoteState); err != nil {
		writeWorkspaceChatError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (a *API) deleteWorkspaceChat(w http.ResponseWriter, r *http.Request) {
	if err := a.service.DeleteWorkspaceChat(r.PathValue("id")); err != nil {
		writeWorkspaceChatError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (a *API) listWorkspaceChatItems(w http.ResponseWriter, r *http.Request) {
	items, err := a.service.ListWorkspaceChatItems(r.PathValue("id"))
	if err != nil {
		writeWorkspaceChatError(w, err)
		return
	}
	if items == nil {
		items = []domain.WorkspaceChatItem{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (a *API) replaceWorkspaceChatItems(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Items []domain.WorkspaceChatItem `json:"items"`
	}
	if err := decodeChatBody(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	if err := a.service.ReplaceWorkspaceChatItems(r.PathValue("id"), body.Items); err != nil {
		writeWorkspaceChatError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "count": len(body.Items)})
}

func decodeChatBody(r *http.Request, target any) error {
	return json.NewDecoder(http.MaxBytesReader(nil, r.Body, maxChatRequestBytes)).Decode(target)
}

func writeWorkspaceChatError(w http.ResponseWriter, err error) {
	if errors.Is(err, app.ErrInvalidWorkspaceChat) {
		writeError(w, http.StatusBadRequest, "invalid_workspace_chat", err.Error())
		return
	}
	writeError(w, http.StatusInternalServerError, "workspace_chat_failed", err.Error())
}

func (a *API) workspaceAttention(w http.ResponseWriter, r *http.Request) {
	records, err := a.service.WorkspaceAttention(r.URL.Query().Get("project_path"))
	if err != nil {
		writeWorkspaceChatError(w, err)
		return
	}
	if records == nil {
		records = []app.AttentionRecord{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"records": records})
}
