package app

import (
	"errors"
	"path/filepath"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/domain"
)

// Workspace chat index and transcripts.
//
// This state used to live only in the browser's localStorage. A single "clear
// data" destroyed every chat title, ordering, conversation binding and
// transcript, while the sessions those chats drove — and their MinIO artifacts
// — survived untouched in the backend. The chat index is durable project state
// and belongs with them.

const (
	maxChatTitleLength = 200
	maxChatURLLength   = 2048
)

var ErrInvalidWorkspaceChat = errors.New("invalid workspace chat")

func normalizeProjectPath(value string) (string, error) {
	project := strings.TrimSpace(value)
	if project == "" {
		return "", ErrInvalidWorkspaceChat
	}
	if !filepath.IsAbs(project) {
		return "", ErrInvalidWorkspaceChat
	}
	return filepath.Clean(project), nil
}

func (s *Service) ListWorkspaceChats(projectPath string) ([]domain.WorkspaceChat, error) {
	project, err := normalizeProjectPath(projectPath)
	if err != nil {
		return nil, err
	}
	return s.store.ListWorkspaceChats(project)
}

// SaveWorkspaceChat upserts one chat. The renderer owns chat identity and
// rewrites the same chat as its title, binding or archive state changes, so
// this is deliberately idempotent rather than create-then-update.
func (s *Service) SaveWorkspaceChat(chat domain.WorkspaceChat) (domain.WorkspaceChat, error) {
	if strings.TrimSpace(chat.ID) == "" {
		return domain.WorkspaceChat{}, ErrInvalidWorkspaceChat
	}
	project, err := normalizeProjectPath(chat.ProjectPath)
	if err != nil {
		return domain.WorkspaceChat{}, err
	}
	chat.ProjectPath = project
	chat.Title = boundedText(chat.Title, maxChatTitleLength)
	chat.SessionID = strings.TrimSpace(chat.SessionID)

	// A conversation binding is only ever a trusted ChatGPT conversation URL;
	// anything else is dropped rather than stored and later navigated to.
	chat.ChatGPTURL = normalizeChatGPTConversationURL(chat.ChatGPTURL)
	// A chat save is a full replace of a renderer-owned row, so a client copy
	// that simply does not know the binding would otherwise erase it. The wire
	// format omits chatgpt_url entirely when the renderer has none, and omission
	// decoded as "" is indistinguishable from a deliberate clear — which is how
	// a chat silently lost its conversation and fell back to the ChatGPT home
	// surface, permanently, on an ordinary title or transcript save.
	//
	// Unbinding is an explicit act with its own endpoint
	// (UpdateWorkspaceChatRemote). A generic save may establish or change a
	// binding, never drop one: that matches the affinity invariant, where only
	// an explicit rebind or an explicit Send against a different conversation
	// counts as intent.
	//
	// Archive state is omitted by the same serializer for the same reason and
	// is protected the same way. Archiving was renderer-local plus a session
	// archive call, so the durable row still said "active"; on restart the
	// durable record wins the merge and every chat archived since it became
	// durable came back open. Both fields now survive a save that simply does
	// not mention them.
	if chat.ChatGPTURL == "" || chat.ArchivedAt == nil {
		if existing, err := s.store.GetWorkspaceChat(chat.ID); err == nil {
			if chat.ChatGPTURL == "" {
				chat.ChatGPTURL = normalizeChatGPTConversationURL(existing.ChatGPTURL)
			}
			if chat.ArchivedAt == nil {
				chat.ArchivedAt = existing.ArchivedAt
			}
		}
	}
	chat.ConversationID = chatGPTConversationIDFromURL(chat.ChatGPTURL)
	chat.RemoteProjectRef = boundedText(chat.RemoteProjectRef, 256)
	chat.RemoteTitle = boundedText(chat.RemoteTitle, maxChatTitleLength)
	chat.RemoteState = boundedText(chat.RemoteState, 64)

	if chat.CreatedAt.IsZero() {
		chat.CreatedAt = time.Now().UTC()
	}
	if err := s.store.SaveWorkspaceChat(chat); err != nil {
		return domain.WorkspaceChat{}, err
	}
	return chat, nil
}

func (s *Service) UpdateWorkspaceChatRemote(chatID, chatGPTURL, projectRef, remoteTitle, remoteState string) error {
	id := strings.TrimSpace(chatID)
	if id == "" {
		return ErrInvalidWorkspaceChat
	}
	url := normalizeChatGPTConversationURL(chatGPTURL)
	if chatGPTURL != "" && url == "" {
		return ErrInvalidWorkspaceChat
	}
	return s.store.UpdateWorkspaceChatRemote(id, url, chatGPTConversationIDFromURL(url),
		boundedText(projectRef, 256), boundedText(remoteTitle, maxChatTitleLength), boundedText(remoteState, 64))
}

// SetWorkspaceChatArchived is the explicit archive/restore action for a chat
// row. It exists because a generic save can no longer clear `archived_at`, and
// because it must not be able to: archiving was previously persisted only in
// the browser and in the session's own archive state, so the durable chat row
// still read as active and every archived chat reopened on the next restart.
//
// Restoring is the one operation allowed to clear the flag, and it says so.
func (s *Service) SetWorkspaceChatArchived(chatID string, archived bool) (domain.WorkspaceChat, error) {
	id := strings.TrimSpace(chatID)
	if id == "" {
		return domain.WorkspaceChat{}, ErrInvalidWorkspaceChat
	}
	chat, err := s.store.GetWorkspaceChat(id)
	if err != nil {
		return domain.WorkspaceChat{}, err
	}
	if archived {
		if chat.ArchivedAt == nil {
			at := time.Now().UTC()
			chat.ArchivedAt = &at
		}
	} else {
		chat.ArchivedAt = nil
	}
	if err := s.store.SaveWorkspaceChat(chat); err != nil {
		return domain.WorkspaceChat{}, err
	}
	return chat, nil
}

func (s *Service) DeleteWorkspaceChat(chatID string) error {
	if strings.TrimSpace(chatID) == "" {
		return ErrInvalidWorkspaceChat
	}
	// Removing the chat row without retiring its queue left browser workers
	// waiting on responses, discovering titles and organizing projects for a
	// chat that no longer existed. Remote cleanup jobs are deliberately kept:
	// deleting the conversation and its bundles is what still has to happen.
	if _, err := s.store.SupersedeChatAgentTasksForDeletedChat(chatID, ""); err != nil {
		return err
	}
	return s.store.DeleteWorkspaceChat(chatID)
}

func (s *Service) ListWorkspaceChatItems(chatID string) ([]domain.WorkspaceChatItem, error) {
	if strings.TrimSpace(chatID) == "" {
		return nil, ErrInvalidWorkspaceChat
	}
	return s.store.ListWorkspaceChatItems(chatID)
}

// ReplaceWorkspaceChatItems writes a chat's whole transcript, because the
// renderer owns it as one bounded list that it trims itself.
func (s *Service) ReplaceWorkspaceChatItems(chatID string, items []domain.WorkspaceChatItem) error {
	if strings.TrimSpace(chatID) == "" {
		return ErrInvalidWorkspaceChat
	}
	normalized := make([]domain.WorkspaceChatItem, 0, len(items))
	for _, item := range items {
		if strings.TrimSpace(item.ID) == "" {
			continue
		}
		item.ChatID = chatID
		normalized = append(normalized, item)
	}
	return s.store.ReplaceWorkspaceChatItems(chatID, normalized)
}

func boundedText(value string, limit int) string {
	text := strings.TrimSpace(value)
	if len(text) <= limit {
		return text
	}
	return text[:limit]
}

// normalizeChatGPTConversationURL keeps only a concrete, trusted conversation
// URL. A conversation filed under a ChatGPT project is served from
// `/g/g-p-<project>/c/<id>`, so the id is matched wherever it appears rather
// than only at the root of the path.
func normalizeChatGPTConversationURL(value string) string {
	raw := strings.TrimSpace(value)
	if raw == "" || len(raw) > maxChatURLLength {
		return ""
	}
	if !strings.HasPrefix(raw, "https://chatgpt.com/") {
		return ""
	}
	marker := "/c/"
	at := strings.LastIndex(raw, marker)
	if at == -1 {
		return ""
	}
	id := raw[at+len(marker):]
	if cut := strings.IndexAny(id, "/?#"); cut != -1 {
		id = id[:cut]
	}
	// ChatGPT's transient creation URLs (`/c/WEB:...`) are not durable ids.
	if id == "" || strings.Contains(id, ":") || len(id) > 128 {
		return ""
	}
	for _, r := range id {
		if !(r == '-' || (r >= '0' && r <= '9') || (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z')) {
			return ""
		}
	}
	return raw
}

func chatGPTConversationIDFromURL(value string) string {
	if value == "" {
		return ""
	}
	marker := "/c/"
	at := strings.LastIndex(value, marker)
	if at == -1 {
		return ""
	}
	id := value[at+len(marker):]
	if cut := strings.IndexAny(id, "/?#"); cut != -1 {
		id = id[:cut]
	}
	return id
}
