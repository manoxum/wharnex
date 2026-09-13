package session

import (
	"database/sql"
	"fmt"
	"path/filepath"
	"strings"
)

// Project attribution for browser-agent tasks.
//
// `project_id` is the canonical absolute host project path — the same identity a
// workspace chat and a session already carry. It used to be whatever each caller
// happened to pass: the Orchestrator wrote the project path, the Desktop
// transport wrote the *ChatGPT project display name*, and the translation
// utility wrote nothing. A column with three meanings filters nothing, which is
// why the task panel could not be scoped to a project and why a Worker could not
// be stopped from running work for a project nobody has open (see ADR-0044).
//
// A remote display name is also not an identity: the operator can rename a
// ChatGPT project from ChatGPT's own UI, and every task keyed on the old name
// would silently stop belonging to anything.

// normalizeChatAgentProjectID keeps a canonical absolute host path and discards
// anything else. Discarding is deliberate: storing a non-path leaves a value
// that matches no project filter yet is not recognizable as unattributed, which
// is the worst of both states.
func normalizeChatAgentProjectID(value string) string {
	project := strings.TrimSpace(value)
	if project == "" || !filepath.IsAbs(project) {
		return ""
	}
	return filepath.Clean(project)
}

// resolveChatAgentTaskProject fills in an absent attribution from the task's own
// durable identifiers, so a caller that forgets cannot produce a task that
// escapes every project filter.
//
// An unresolvable task keeps an empty project and belongs to none: a chat may be
// enqueued before its durable row exists, and guessing a project would put one
// project's work on another project's screen.
func (s *Store) resolveChatAgentTaskProject(task ChatAgentTask) string {
	if project := normalizeChatAgentProjectID(task.ProjectID); project != "" {
		return project
	}
	if project := s.workspaceChatProjectPath(task.ChatID); project != "" {
		return project
	}
	// The utility worker enqueues with the session id in both fields, so the
	// session is the only remaining source of truth for it.
	for _, id := range []string{task.SessionID, task.ChatID} {
		if id = strings.TrimSpace(id); id == "" {
			continue
		}
		if item, err := s.Get(id); err == nil {
			if project := normalizeChatAgentProjectID(item.ProjectPath); project != "" {
				return project
			}
		}
	}
	return ""
}

// workspaceChatProjectPath resolves one chat's owning project, or "" when the
// chat is unknown. A lookup failure is not an error here: attribution is best
// effort by design and must never fail an enqueue.
func (s *Store) workspaceChatProjectPath(chatID string) string {
	id := strings.TrimSpace(chatID)
	if id == "" {
		return ""
	}
	if s.db == nil {
		s.mu.RLock()
		defer s.mu.RUnlock()
		for _, chats := range s.chatFallback() {
			for _, chat := range chats {
				if chat.ID == id {
					return normalizeChatAgentProjectID(chat.ProjectPath)
				}
			}
		}
		return ""
	}
	var project string
	err := s.db.QueryRow(`SELECT project_path FROM harness_workspace_chats WHERE id=$1`, id).Scan(&project)
	if err != nil {
		if err != sql.ErrNoRows {
			// Worth knowing about, never worth failing the enqueue over.
			fmt.Printf("[chat-agent] project attribution lookup failed chat=%s error=%v\n", id, err)
		}
		return ""
	}
	return normalizeChatAgentProjectID(project)
}
