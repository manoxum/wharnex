package workspacetranscript

import (
	"database/sql"
	"errors"
	"fmt"
	"time"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/session/transcript"
)

type Store interface {
	GetWorkspaceChat(string) (domain.WorkspaceChat, error)
	AppendWorkspaceChatItems(string, []domain.WorkspaceChatItem) error
}

func RecordRequest(store Store, item domain.Session, message string) (*domain.WorkspaceChatItem, error) {
	if item.ChatID == "" || item.LastRequestID == "" {
		return nil, nil
	}
	chat, err := store.GetWorkspaceChat(item.ChatID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	if chat.SessionID != item.ID || chat.ProjectPath != item.ProjectPath {
		return nil, fmt.Errorf("request transcript chat does not own the session")
	}
	now := time.Now().UTC()
	id := "request:" + item.LastRequestID
	entry := domain.WorkspaceChatItem{
		ID: id, ChatID: item.ChatID, CreatedAt: now,
		Payload: map[string]any{
			"id": id, "role": "user", "source": "user", "text": message, "createdAt": now.Format(time.RFC3339Nano),
			"iteration":      map[string]any{"id": id, "requestId": item.LastRequestID, "phase": "outbound", "artifacts": []string{"prompt"}},
			transcript.Owned: true,
		},
	}
	if err := store.AppendWorkspaceChatItems(item.ChatID, []domain.WorkspaceChatItem{entry}); err != nil {
		return nil, err
	}
	return &entry, nil
}
