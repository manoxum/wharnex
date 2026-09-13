package session

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/domain"
)

// Durable storage for the workspace chat index and transcripts.
//
// These lived in the browser's localStorage, where a single "clear data" wiped
// every chat title, ordering, conversation binding and transcript while the
// Sessions and their MinIO artifacts survived untouched. Chats are durable
// project state and belong in the same store as the sessions they drive.
//
// The in-memory fallback mirrors the pattern the rest of this store uses: it
// keeps tests and non-Postgres development working without pretending to be
// durable.

const maxChatItemsPerChat = 2000

func (s *Store) chatFallback() map[string][]domain.WorkspaceChat {
	if s.workspaceChats == nil {
		s.workspaceChats = make(map[string][]domain.WorkspaceChat)
	}
	return s.workspaceChats
}

func (s *Store) chatItemFallback() map[string][]domain.WorkspaceChatItem {
	if s.workspaceChatItems == nil {
		s.workspaceChatItems = make(map[string][]domain.WorkspaceChatItem)
	}
	return s.workspaceChatItems
}

// ListWorkspaceChats returns every chat of a project, newest first. Archived
// chats are included; the caller decides how to present them.
func (s *Store) ListWorkspaceChats(projectPath string) ([]domain.WorkspaceChat, error) {
	project := strings.TrimSpace(projectPath)
	if project == "" {
		return nil, fmt.Errorf("project_path is required")
	}
	if s.db == nil {
		s.mu.RLock()
		defer s.mu.RUnlock()
		chats := append([]domain.WorkspaceChat(nil), s.chatFallback()[project]...)
		sort.Slice(chats, func(i, j int) bool { return chats[i].UpdatedAt.After(chats[j].UpdatedAt) })
		return chats, nil
	}

	rows, err := s.db.Query(`SELECT id, project_path, session_id, title, chatgpt_url, conversation_id, remote_project_ref,
		remote_title, remote_state, archived_at, created_at, updated_at, payload
		FROM harness_workspace_chats WHERE project_path=$1 ORDER BY updated_at DESC, id`, project)
	if err != nil {
		return nil, fmt.Errorf("list workspace chats: %w", err)
	}
	defer rows.Close()

	chats := make([]domain.WorkspaceChat, 0, 32)
	for rows.Next() {
		var chat domain.WorkspaceChat
		var archivedAt sql.NullTime
		var payload []byte
		if err := rows.Scan(&chat.ID, &chat.ProjectPath, &chat.SessionID, &chat.Title, &chat.ChatGPTURL,
			&chat.ConversationID, &chat.RemoteProjectRef, &chat.RemoteTitle, &chat.RemoteState,
			&archivedAt, &chat.CreatedAt, &chat.UpdatedAt, &payload); err != nil {
			return nil, fmt.Errorf("scan workspace chat: %w", err)
		}
		if archivedAt.Valid {
			at := archivedAt.Time
			chat.ArchivedAt = &at
		}
		if len(payload) > 0 {
			_ = json.Unmarshal(payload, &chat.Extra)
		}
		chats = append(chats, chat)
	}
	return chats, rows.Err()
}

// GetWorkspaceChat returns one chat by id. It exists so a save can consult what
// is already stored before overwriting it: the renderer sends a whole row, and
// a field it does not know about must not be read as a field it cleared.
func (s *Store) GetWorkspaceChat(chatID string) (domain.WorkspaceChat, error) {
	id := strings.TrimSpace(chatID)
	if id == "" {
		return domain.WorkspaceChat{}, fmt.Errorf("workspace chat id is required")
	}
	if s.db == nil {
		s.mu.RLock()
		defer s.mu.RUnlock()
		for _, chats := range s.chatFallback() {
			for _, chat := range chats {
				if chat.ID == id {
					return chat, nil
				}
			}
		}
		return domain.WorkspaceChat{}, sql.ErrNoRows
	}
	var chat domain.WorkspaceChat
	var archivedAt sql.NullTime
	var payload []byte
	err := s.db.QueryRow(`SELECT id, project_path, session_id, title, chatgpt_url, conversation_id, remote_project_ref,
		remote_title, remote_state, archived_at, created_at, updated_at, payload
		FROM harness_workspace_chats WHERE id=$1`, id).Scan(&chat.ID, &chat.ProjectPath, &chat.SessionID, &chat.Title,
		&chat.ChatGPTURL, &chat.ConversationID, &chat.RemoteProjectRef, &chat.RemoteTitle, &chat.RemoteState,
		&archivedAt, &chat.CreatedAt, &chat.UpdatedAt, &payload)
	if err != nil {
		return domain.WorkspaceChat{}, err
	}
	if archivedAt.Valid {
		at := archivedAt.Time
		chat.ArchivedAt = &at
	}
	if len(payload) > 0 {
		_ = json.Unmarshal(payload, &chat.Extra)
	}
	return chat, nil
}

// SaveWorkspaceChat inserts or updates one chat. It is an upsert because the
// renderer owns chat identity: the same chat is written repeatedly as its
// title, binding or archive state changes.
func (s *Store) SaveWorkspaceChat(chat domain.WorkspaceChat) error {
	if strings.TrimSpace(chat.ID) == "" || strings.TrimSpace(chat.ProjectPath) == "" {
		return fmt.Errorf("workspace chat id and project_path are required")
	}
	now := time.Now().UTC()
	if chat.CreatedAt.IsZero() {
		chat.CreatedAt = now
	}
	chat.UpdatedAt = now

	if s.db == nil {
		s.mu.Lock()
		defer s.mu.Unlock()
		store := s.chatFallback()
		list := store[chat.ProjectPath]
		replaced := false
		for i := range list {
			if list[i].ID == chat.ID {
				list[i] = chat
				replaced = true
				break
			}
		}
		if !replaced {
			list = append(list, chat)
		}
		store[chat.ProjectPath] = list
		return nil
	}

	payload, err := json.Marshal(chat.Extra)
	if err != nil {
		return fmt.Errorf("encode workspace chat payload: %w", err)
	}
	var archivedAt any
	if chat.Archived() {
		archivedAt = *chat.ArchivedAt
	}
	_, err = s.db.Exec(`INSERT INTO harness_workspace_chats
			(id, project_path, session_id, title, chatgpt_url, conversation_id, remote_project_ref,
			 remote_title, remote_state, archived_at, created_at, updated_at, payload)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
		ON CONFLICT (id) DO UPDATE SET
			project_path=EXCLUDED.project_path,
			session_id=EXCLUDED.session_id,
			title=EXCLUDED.title,
			chatgpt_url=EXCLUDED.chatgpt_url,
			conversation_id=EXCLUDED.conversation_id,
			remote_project_ref=EXCLUDED.remote_project_ref,
			remote_title=EXCLUDED.remote_title,
			remote_state=EXCLUDED.remote_state,
			archived_at=EXCLUDED.archived_at,
			updated_at=EXCLUDED.updated_at,
			payload=EXCLUDED.payload`,
		chat.ID, chat.ProjectPath, chat.SessionID, chat.Title, chat.ChatGPTURL, chat.ConversationID,
		chat.RemoteProjectRef, chat.RemoteTitle, chat.RemoteState, archivedAt, chat.CreatedAt, chat.UpdatedAt, payload)
	if err != nil {
		return fmt.Errorf("persist workspace chat: %w", err)
	}
	return nil
}

// UpdateWorkspaceChatRemote updates only the browser-affinity metadata owned by
// the Desktop scheduler. It deliberately leaves renderer-owned transcript and
// project fields untouched, so a worker can persist a confirmed ChatGPT POST
// immediately without racing a whole-record rewrite from the frontend.
func (s *Store) UpdateWorkspaceChatRemote(chatID, chatGPTURL, conversationID, projectRef, remoteTitle, remoteState string) error {
	id := strings.TrimSpace(chatID)
	if id == "" {
		return fmt.Errorf("workspace chat id is required")
	}
	now := time.Now().UTC()
	if s.db == nil {
		s.mu.Lock()
		defer s.mu.Unlock()
		for project, list := range s.chatFallback() {
			for i := range list {
				if list[i].ID != id {
					continue
				}
				list[i].ChatGPTURL = chatGPTURL
				list[i].ConversationID = conversationID
				list[i].RemoteProjectRef = projectRef
				list[i].RemoteTitle = remoteTitle
				if localTitle := workspaceLocalTitle(remoteTitle); localTitle != "" {
					list[i].Title = localTitle
				}
				list[i].RemoteState = remoteState
				list[i].UpdatedAt = now
				s.chatFallback()[project] = list
				return nil
			}
		}
		return fmt.Errorf("workspace chat not found")
	}
	localTitle := workspaceLocalTitle(remoteTitle)
	result, err := s.db.Exec(`UPDATE harness_workspace_chats
		SET chatgpt_url=$2, conversation_id=$3, remote_project_ref=$4, remote_title=$5,
			title=CASE WHEN BTRIM($8) <> '' THEN $8 ELSE title END,
			remote_state=$6, updated_at=$7
		WHERE id=$1`, id, chatGPTURL, conversationID, projectRef, remoteTitle, remoteState, now, localTitle)
	if err != nil {
		return fmt.Errorf("update workspace chat remote state: %w", err)
	}
	if rows, _ := result.RowsAffected(); rows == 0 {
		return fmt.Errorf("workspace chat not found")
	}
	return nil
}

func workspaceLocalTitle(remoteTitle string) string {
	title := strings.TrimSpace(remoteTitle)
	if len(title) >= 4 && strings.EqualFold(title[:4], "WHX:") {
		title = strings.TrimSpace(title[4:])
	}
	return title
}

// DeleteWorkspaceChat removes a chat and its transcript. Used by permanent
// deletion only; archiving is a state change, not a delete.
func (s *Store) DeleteWorkspaceChat(chatID string) error {
	id := strings.TrimSpace(chatID)
	if id == "" {
		return fmt.Errorf("workspace chat id is required")
	}
	if s.db == nil {
		s.mu.Lock()
		defer s.mu.Unlock()
		for project, list := range s.chatFallback() {
			kept := list[:0]
			for _, chat := range list {
				if chat.ID != id {
					kept = append(kept, chat)
				}
			}
			s.chatFallback()[project] = kept
		}
		delete(s.chatItemFallback(), id)
		return nil
	}
	if _, err := s.db.Exec(`DELETE FROM harness_chat_items WHERE chat_id=$1`, id); err != nil {
		return fmt.Errorf("delete workspace chat transcript: %w", err)
	}
	if _, err := s.db.Exec(`DELETE FROM harness_workspace_chats WHERE id=$1`, id); err != nil {
		return fmt.Errorf("delete workspace chat: %w", err)
	}
	return nil
}

// ListWorkspaceChatItems returns a chat's transcript in creation order.
func (s *Store) ListWorkspaceChatItems(chatID string) ([]domain.WorkspaceChatItem, error) {
	id := strings.TrimSpace(chatID)
	if id == "" {
		return nil, fmt.Errorf("workspace chat id is required")
	}
	if s.db == nil {
		s.mu.RLock()
		defer s.mu.RUnlock()
		return append([]domain.WorkspaceChatItem(nil), s.chatItemFallback()[id]...), nil
	}

	rows, err := s.db.Query(`SELECT item_id, chat_id, created_at, payload FROM harness_chat_items
		WHERE chat_id=$1 ORDER BY created_at, item_id`, id)
	if err != nil {
		return nil, fmt.Errorf("list workspace chat items: %w", err)
	}
	defer rows.Close()

	items := make([]domain.WorkspaceChatItem, 0, 64)
	for rows.Next() {
		var item domain.WorkspaceChatItem
		var payload []byte
		if err := rows.Scan(&item.ID, &item.ChatID, &item.CreatedAt, &payload); err != nil {
			return nil, fmt.Errorf("scan workspace chat item: %w", err)
		}
		if len(payload) > 0 {
			_ = json.Unmarshal(payload, &item.Payload)
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

// ReplaceWorkspaceChatItems writes a chat's whole transcript.
//
// Replace rather than append because the renderer owns the transcript as one
// bounded list it rewrites (it trims old entries itself), so a partial append
// protocol would leave the two representations able to disagree.
func (s *Store) ReplaceWorkspaceChatItems(chatID string, items []domain.WorkspaceChatItem) error {
	id := strings.TrimSpace(chatID)
	if id == "" {
		return fmt.Errorf("workspace chat id is required")
	}
	if len(items) > maxChatItemsPerChat {
		items = items[len(items)-maxChatItemsPerChat:]
	}

	if s.db == nil {
		s.mu.Lock()
		defer s.mu.Unlock()
		s.chatItemFallback()[id] = append([]domain.WorkspaceChatItem(nil), items...)
		return nil
	}

	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("begin transcript write: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.Exec(`DELETE FROM harness_chat_items WHERE chat_id=$1`, id); err != nil {
		return fmt.Errorf("clear transcript: %w", err)
	}
	statement, err := tx.Prepare(`INSERT INTO harness_chat_items (chat_id, item_id, created_at, payload) VALUES ($1,$2,$3,$4)
		ON CONFLICT (chat_id, item_id) DO UPDATE SET created_at=EXCLUDED.created_at, payload=EXCLUDED.payload`)
	if err != nil {
		return fmt.Errorf("prepare transcript write: %w", err)
	}
	defer statement.Close()

	for _, item := range items {
		if strings.TrimSpace(item.ID) == "" {
			continue
		}
		payload, err := json.Marshal(item.Payload)
		if err != nil {
			return fmt.Errorf("encode chat item: %w", err)
		}
		createdAt := item.CreatedAt
		if createdAt.IsZero() {
			createdAt = time.Now().UTC()
		}
		if _, err := statement.Exec(id, item.ID, createdAt, payload); err != nil {
			return fmt.Errorf("persist chat item: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit transcript write: %w", err)
	}
	return nil
}
