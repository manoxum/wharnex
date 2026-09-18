package app

import (
	"testing"

	"kernl.local/harness/backend/internal/domain"
)

func TestSavedWorkspaceChatRequiresExplicitReactivation(t *testing.T) {
	service := bindingService(t)
	root := t.TempDir()
	chat := domain.WorkspaceChat{ID: "chat-saved", ProjectPath: root, SessionID: "ses-saved", Title: "Pending"}
	if _, err := service.SaveWorkspaceChat(chat); err != nil {
		t.Fatal(err)
	}
	saved, err := service.SetWorkspaceChatSaved(chat.ID, true)
	if err != nil {
		t.Fatal(err)
	}
	if !saved.Saved() || saved.Archived() {
		t.Fatalf("expected saved chat, got %+v", saved)
	}

	// Generic saves intentionally omit lifecycle fields. They must not reactivate
	// work that the operator parked for later.
	updated, err := service.SaveWorkspaceChat(domain.WorkspaceChat{ID: chat.ID, ProjectPath: root, SessionID: chat.SessionID, Title: "Retitled"})
	if err != nil {
		t.Fatal(err)
	}
	if !updated.Saved() {
		t.Fatal("ordinary save reactivated a saved chat")
	}

	reactivated, err := service.SetWorkspaceChatSaved(chat.ID, false)
	if err != nil {
		t.Fatal(err)
	}
	if reactivated.Saved() {
		t.Fatal("explicit reactivation did not clear saved state")
	}
}

func TestArchivingSavedWorkspaceChatEndsStandbyState(t *testing.T) {
	service := bindingService(t)
	root := t.TempDir()
	chat := domain.WorkspaceChat{ID: "chat-saved-archive", ProjectPath: root, SessionID: "ses-saved-archive", Title: "Pending"}
	if _, err := service.SaveWorkspaceChat(chat); err != nil {
		t.Fatal(err)
	}
	if _, err := service.SetWorkspaceChatSaved(chat.ID, true); err != nil {
		t.Fatal(err)
	}
	archived, err := service.SetWorkspaceChatArchived(chat.ID, true)
	if err != nil {
		t.Fatal(err)
	}
	if archived.Saved() || !archived.Archived() {
		t.Fatalf("archive must replace saved state, got %+v", archived)
	}
}
