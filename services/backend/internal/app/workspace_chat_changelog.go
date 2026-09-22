package app

import (
	"context"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/projectchangelog"
)

// changelogReservationTimeout bounds the internal read-modify-write-commit a
// chat's CHANGELOG.md reservation performs. It shares the project apply lock
// with real host integration (see projectApplyLock), so a concurrent Apply
// can make a chat briefly wait for it — that queuing is the intended
// replacement for racing a merge. The bound exists so a stuck or unusually
// slow lock holder degrades a chat-creation/archive request rather than
// hanging it: like the execution-environment probe, this is valuable but
// never load bearing.
const changelogReservationTimeout = 15 * time.Second

// reserveChangelogSection attempts to reserve chatID's own CHANGELOG.md
// heading and returns the heading text to store on the chat row, or "" when
// the attempt could not complete. It never returns an error: reservation is
// auxiliary bookkeeping in the same class as the execution-environment
// manifest or the attempt ledger, and a project with no Git repository yet
// (every workspacechats_test.go fixture, for instance) must keep saving chats
// exactly as it did before this feature existed.
//
// Reservation is Wharnex-owned bookkeeping, never a planner-authored patch —
// see the package doc on internal/projectchangelog for why that distinction
// is what actually prevents the collision this exists to reduce. Serializing
// it on the project's existing apply lock is what lets two chats starting
// concurrently on the same project queue briefly instead of racing a merge.
func (s *Service) reserveChangelogSection(sessionID, projectPath, chatID string) string {
	projectPath = strings.TrimSpace(projectPath)
	chatID = strings.TrimSpace(chatID)
	if projectPath == "" || chatID == "" {
		return ""
	}
	ctx, cancel := context.WithTimeout(context.Background(), changelogReservationTimeout)
	defer cancel()
	lock := s.projectApplyLock(projectPath)
	lock.Lock()
	defer lock.Unlock()
	heading, _, err := projectchangelog.Reserve(ctx, projectPath, chatID, time.Now())
	if err != nil {
		s.bus.Publish(sessionID, "changelog.reservation_failed", map[string]any{"chat_id": chatID, "error": err.Error()})
		return ""
	}
	return heading
}

// cleanupEmptyChangelogSection deletes chatID's reservation when a planner
// never wrote anything under it, so an archived chat that did no changelog
// work leaves no permanent empty heading behind. It is called on its own
// goroutine from SetWorkspaceChatArchived (see the comment there): archiving
// itself must stay an instant, idempotent state flip per ADR-0031, so this
// runs after that response has already been returned and clears the chat
// row's stored heading itself, once it knows whether removal actually
// happened — a block still carrying real planner content is never removed,
// and the row must keep pointing at it.
//
// Best effort throughout, like reservation: a failure here is recorded and
// never surfaces as an archive failure.
//
// Known v1 limitation: a chat that is abandoned without ever being explicitly
// archived (closed tab, uninstalled Desktop, ...) has no lifecycle signal this
// hooks into, so its empty reservation is never cleaned up. Wharnex has no
// durable "this chat will never be touched again" event to attach to today;
// adding one is future work rather than something this change should invent.
func (s *Service) cleanupEmptyChangelogSection(sessionID, projectPath, chatID string) {
	projectPath = strings.TrimSpace(projectPath)
	chatID = strings.TrimSpace(chatID)
	if projectPath == "" || chatID == "" {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), changelogReservationTimeout)
	defer cancel()
	lock := s.projectApplyLock(projectPath)
	lock.Lock()
	removed, err := projectchangelog.RemoveEmptyReservation(ctx, projectPath, chatID)
	lock.Unlock()
	if err != nil {
		s.bus.Publish(sessionID, "changelog.reservation_cleanup_failed", map[string]any{"chat_id": chatID, "error": err.Error()})
		return
	}
	if !removed {
		return
	}
	chat, err := s.store.GetWorkspaceChat(chatID)
	if err != nil {
		return
	}
	chat.ChangelogHeading = ""
	chat.UpdatedAt = time.Now().UTC()
	_ = s.store.SaveWorkspaceChat(chat)
}

// changelogPromptSection resolves the current chat's reserved heading, if any,
// into the pre-rendered planner prompt section. Returns "" when the session
// has no linked workspace chat or that chat never obtained a reservation, in
// which case the prompt simply omits the section like every other measured
// one.
func (s *Service) changelogPromptSection(chatID string) string {
	chatID = strings.TrimSpace(chatID)
	if chatID == "" {
		return ""
	}
	chat, err := s.store.GetWorkspaceChat(chatID)
	if err != nil {
		return ""
	}
	return projectchangelog.RenderPromptSection(chat.ChangelogHeading)
}
