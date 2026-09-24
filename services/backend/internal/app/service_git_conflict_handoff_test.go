package app

import (
	"context"
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/domain"
)

// Under the GPT-only strategy a host Git conflict is resolved in its own chat:
// the conflict is prepared anew on the dedicated session, marked sendable, and
// released from the chat whose Git surface detected it.
func TestGitConflictHandsOffToADedicatedChat(t *testing.T) {
	requireGitForApp(t)
	service, _ := gitSurfaceService(t)
	root, sourceID, _ := pushSetup(t, service, true)
	ctx := context.Background()
	if _, err := service.PushBranch(ctx, sourceID, "origin", "main", false); err != nil {
		t.Fatal(err)
	}
	source, err := service.GetSession(sourceID)
	if err != nil || source.IntegrationConflict == nil {
		t.Fatalf("expected a recorded conflict, got %+v err=%v", source.IntegrationConflict, err)
	}
	if source.IntegrationConflict.Git.AutoDispatch {
		t.Fatal("a freshly detected Git conflict waits for the operator's choice before any dispatch")
	}

	targetID := startGitSession(t, service, root)
	if _, err := service.store.Update(targetID, func(current *domain.Session) error { current.ChatID = "chat-dedicated-conflict"; return nil }); err != nil {
		t.Fatal(err)
	}
	if _, err := service.HandOffGitConflict(ctx, sourceID, sourceID); err == nil {
		t.Fatal("a conflict cannot be handed off to the session that already holds it")
	}

	target, err := service.HandOffGitConflict(ctx, sourceID, targetID)
	if err != nil {
		t.Fatal(err)
	}
	conflict := target.IntegrationConflict
	if conflict == nil || conflict.Git == nil || !conflict.Git.AutoDispatch {
		t.Fatalf("the dedicated session must hold a sendable Git conflict, got %+v", conflict)
	}
	if conflict.Git.TheirsSHA != source.IntegrationConflict.Git.TheirsSHA || conflict.Git.Origin != domain.GitConflictOriginPush {
		t.Fatalf("the dedicated conflict must replay the same merge, got %+v", conflict.Git)
	}
	if target.State != "conflict_resolution_pending" || !strings.Contains(target.LastManualPrompt, conflictCapsuleArtifactPath) {
		t.Fatalf("the dedicated session must be ready to send the capsule, got state=%q", target.State)
	}
	if !strings.Contains(target.LastManualPrompt, "chat-dedicated-conflict") {
		t.Fatal("the expected answer bundle must be named for the dedicated chat")
	}

	released, err := service.GetSession(sourceID)
	if err != nil {
		t.Fatal(err)
	}
	if released.IntegrationConflict != nil || released.State != "ready" {
		t.Fatalf("the originating chat must be released, got state=%q conflict=%+v", released.State, released.IntegrationConflict)
	}
	if _, ignored, _ := service.ignoreObsoleteConflictAnswer(sourceID, released, source.IntegrationConflict.RequestID); !ignored {
		t.Fatal("an answer to the handed-off request in the originating chat must be ignored")
	}
}

func TestExplicitGPTDelegationMakesAGitConflictSendable(t *testing.T) {
	requireGitForApp(t)
	service, _ := gitSurfaceService(t)
	_, sessionID, _ := pushSetup(t, service, true)
	if _, err := service.PushBranch(context.Background(), sessionID, "origin", "main", false); err != nil {
		t.Fatal(err)
	}
	updated, err := service.DelegateConflictToGPT(context.Background(), sessionID, nil, "")
	if err != nil {
		t.Fatal(err)
	}
	if updated.IntegrationConflict == nil || !updated.IntegrationConflict.Git.AutoDispatch {
		t.Fatal("an explicit delegation is the operator's choice to send the conflict")
	}
}
