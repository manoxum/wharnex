package workspacetranscript

import (
	"fmt"
	"time"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/session/transcript"
)

type AppendStore interface {
	Store
	Get(string) (domain.Session, error)
}

func Append(store AppendStore, chatID string, incoming []domain.WorkspaceChatItem) ([]domain.WorkspaceChatItem, domain.Session, error) {
	chat, err := store.GetWorkspaceChat(chatID)
	if err != nil {
		return nil, domain.Session{}, err
	}
	item, err := store.Get(chat.SessionID)
	if err != nil {
		return nil, domain.Session{}, err
	}
	if item.ChatID != chat.ID || item.ProjectPath != chat.ProjectPath {
		return nil, item, fmt.Errorf("transcript chat does not own the session")
	}
	entries := transcript.Normalize(chat.ID, incoming)
	for i := range entries {
		entry := &entries[i]
		role, _ := entry.Payload["role"].(string)
		if role != "user" && role != "harness" {
			return nil, item, fmt.Errorf("transcript item requires user or harness role")
		}
		if _, ok := entry.Payload["text"].(string); !ok {
			return nil, item, fmt.Errorf("transcript item requires text")
		}
		payload := make(map[string]any, len(entry.Payload)+3)
		for key, value := range entry.Payload {
			payload[key] = value
		}
		payload["id"] = entry.ID
		payload["createdAt"] = entry.CreatedAt.Format(time.RFC3339Nano)
		payload[transcript.Owned] = true
		entry.Payload = payload
	}
	if err := store.AppendWorkspaceChatItems(chatID, entries); err != nil {
		return nil, item, err
	}
	return entries, item, nil
}
