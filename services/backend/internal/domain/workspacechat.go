package domain

import "time"

// WorkspaceChat is a chat as the workspace presents it: its title, which
// backend Session it drives, and which remote conversation it is bound to.
//
// This lived only in the browser's localStorage, which is not storage: a
// single "clear data" wiped every chat title, ordering and conversation
// binding, while the Sessions and their MinIO artifacts survived untouched in
// the backend. The chat index is durable state and belongs beside them.
type WorkspaceChat struct {
	ID               string     `json:"id"`
	ProjectPath      string     `json:"project_path"`
	SessionID        string     `json:"session_id"`
	Title            string     `json:"title"`
	ChatGPTURL       string     `json:"chatgpt_url,omitempty"`
	ConversationID   string     `json:"conversation_id,omitempty"`
	RemoteProjectRef string     `json:"remote_project_ref,omitempty"`
	RemoteTitle      string     `json:"remote_title,omitempty"`
	RemoteState      string     `json:"remote_state,omitempty"`
	SavedAt          *time.Time `json:"saved_at,omitempty"`
	ArchivedAt       *time.Time `json:"archived_at,omitempty"`
	CreatedAt        time.Time  `json:"created_at"`
	UpdatedAt        time.Time  `json:"updated_at"`

	// ChangelogHeading is the exact CHANGELOG.md heading Wharnex reserved for
	// this chat (see internal/projectchangelog), backend-owned like ArchivedAt
	// rather than renderer-owned like Extra: the archive path reads it back to
	// find and clean up an untouched reservation, and the planner prompt reads
	// it to tell the model exactly where its section lives. Empty when no
	// reservation was ever attempted or committed for this chat.
	ChangelogHeading string `json:"changelog_heading,omitempty"`

	// Renderer-owned fields the backend stores but never interprets: artifact
	// selection, transport options, conflict surfaces, naming/remote-archive
	// bookkeeping. Keeping them opaque means the frontend can evolve its own
	// per-chat state without a schema migration for every field.
	Extra map[string]any `json:"extra,omitempty"`
}

// WorkspaceChatItem is one entry of a chat transcript.
//
// Stored as an opaque payload for the same reason as WorkspaceChat.Extra: the
// renderer owns the shape of a chat item, and the backend's job is to keep it
// safe and ordered, not to understand it.
type WorkspaceChatItem struct {
	ID        string         `json:"id"`
	ChatID    string         `json:"chat_id"`
	CreatedAt time.Time      `json:"created_at"`
	Payload   map[string]any `json:"payload"`
}

func (c WorkspaceChat) Saved() bool    { return c.SavedAt != nil && !c.SavedAt.IsZero() }
func (c WorkspaceChat) Archived() bool { return c.ArchivedAt != nil && !c.ArchivedAt.IsZero() }
