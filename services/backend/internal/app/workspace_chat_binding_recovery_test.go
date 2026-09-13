package app

import (
	"testing"

	"kernl.local/harness/backend/internal/audit"
	"kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/domain"
	manualplanner "kernl.local/harness/backend/internal/planner/manual"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/sandbox"
	"kernl.local/harness/backend/internal/session"
)

func bindingService(t *testing.T) *Service {
	t.Helper()
	return NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), sandbox.NewLocalRunner())
}

const boundConversation = "https://chatgpt.com/c/6aa5c907-0944-83ea-a71b-eeeeeeeeeeee"

// The production defect: a chat save is a full replace, and the renderer omits
// chatgpt_url entirely when its own copy has none. Omission decoded as "" is
// indistinguishable from a deliberate clear, so an ordinary title or transcript
// save erased the durable binding and the chat fell back to the ChatGPT home
// surface — permanently, since conversation_id is derived from the same URL and
// died with it.
func TestAnOrdinaryChatSaveCannotClearAnExistingBinding(t *testing.T) {
	service := bindingService(t)
	root := t.TempDir()
	chat := domain.WorkspaceChat{ID: "chat-1", ProjectPath: root, SessionID: "ses-1", Title: "Bound", ChatGPTURL: boundConversation}
	if _, err := service.SaveWorkspaceChat(chat); err != nil {
		t.Fatal(err)
	}
	// The renderer saves again with a copy that knows nothing about the binding.
	partial := domain.WorkspaceChat{ID: "chat-1", ProjectPath: root, SessionID: "ses-1", Title: "Bound, retitled"}
	saved, err := service.SaveWorkspaceChat(partial)
	if err != nil {
		t.Fatal(err)
	}
	if saved.ChatGPTURL != boundConversation {
		t.Fatalf("binding was erased by an ordinary save: %q", saved.ChatGPTURL)
	}
	if saved.ConversationID == "" {
		t.Fatal("conversation id must be preserved with the URL it derives from")
	}
	if saved.Title != "Bound, retitled" {
		t.Fatalf("the save must still apply its own changes, got title %q", saved.Title)
	}
}

// Establishing or changing a binding through a save is still allowed: only
// dropping one is reserved for the explicit remote endpoint.
func TestAChatSaveMayStillSetOrChangeABinding(t *testing.T) {
	service := bindingService(t)
	root := t.TempDir()
	if _, err := service.SaveWorkspaceChat(domain.WorkspaceChat{ID: "chat-2", ProjectPath: root, Title: "New"}); err != nil {
		t.Fatal(err)
	}
	saved, err := service.SaveWorkspaceChat(domain.WorkspaceChat{ID: "chat-2", ProjectPath: root, Title: "New", ChatGPTURL: boundConversation})
	if err != nil {
		t.Fatal(err)
	}
	if saved.ChatGPTURL != boundConversation {
		t.Fatalf("a save must still be able to establish a binding, got %q", saved.ChatGPTURL)
	}
	other := "https://chatgpt.com/c/6aa5d491-59f8-83ea-8ce8-600000000000"
	saved, err = service.SaveWorkspaceChat(domain.WorkspaceChat{ID: "chat-2", ProjectPath: root, Title: "New", ChatGPTURL: other})
	if err != nil {
		t.Fatal(err)
	}
	if saved.ChatGPTURL != other {
		t.Fatalf("a save must still be able to change a binding, got %q", saved.ChatGPTURL)
	}
}

// Unbinding remains possible, but only through the explicit remote action.
func TestExplicitRemoteUpdateStillUnbinds(t *testing.T) {
	service := bindingService(t)
	root := t.TempDir()
	if _, err := service.SaveWorkspaceChat(domain.WorkspaceChat{ID: "chat-3", ProjectPath: root, Title: "Bound", ChatGPTURL: boundConversation}); err != nil {
		t.Fatal(err)
	}
	if err := service.UpdateWorkspaceChatRemote("chat-3", "", "", "", ""); err != nil {
		t.Fatal(err)
	}
	chats, err := service.ListWorkspaceChats(root)
	if err != nil {
		t.Fatal(err)
	}
	for _, chat := range chats {
		if chat.ID == "chat-3" && chat.ChatGPTURL != "" {
			t.Fatalf("an explicit unbind must still clear the binding, got %q", chat.ChatGPTURL)
		}
	}
}

// Recovery reconstructs a lost binding from the chat's own transcript, and says
// where the candidate came from so the operator can judge it.
func TestBindingRecoveryProposesCandidatesFromTranscript(t *testing.T) {
	service := bindingService(t)
	root := t.TempDir()
	if _, err := service.SaveWorkspaceChat(domain.WorkspaceChat{ID: "chat-4", ProjectPath: root, SessionID: "ses-4", Title: "Broken"}); err != nil {
		t.Fatal(err)
	}
	if err := service.ReplaceWorkspaceChatItems("chat-4", []domain.WorkspaceChatItem{
		{ID: "i1", Payload: map[string]any{"text": "conversa em " + boundConversation}},
	}); err != nil {
		t.Fatal(err)
	}
	recovery, err := service.RecoverWorkspaceChatBinding("chat-4")
	if err != nil {
		t.Fatal(err)
	}
	if recovery.Bound {
		t.Fatal("the chat under recovery must be reported as unbound")
	}
	if len(recovery.Candidates) != 1 {
		t.Fatalf("candidates = %+v", recovery.Candidates)
	}
	candidate := recovery.Candidates[0]
	if candidate.ChatGPTURL != boundConversation || candidate.Evidence != BindingEvidenceTranscript || candidate.Conflict {
		t.Fatalf("unexpected candidate: %+v", candidate)
	}
}

// A conversation another chat already owns is reported as a conflict rather
// than offered: taking it would send the next request into that chat's thread.
func TestBindingRecoveryMarksAConversationOwnedByAnotherChat(t *testing.T) {
	service := bindingService(t)
	root := t.TempDir()
	if _, err := service.SaveWorkspaceChat(domain.WorkspaceChat{ID: "owner", ProjectPath: root, Title: "Owner", ChatGPTURL: boundConversation}); err != nil {
		t.Fatal(err)
	}
	if _, err := service.SaveWorkspaceChat(domain.WorkspaceChat{ID: "broken", ProjectPath: root, SessionID: "ses-5", Title: "Broken"}); err != nil {
		t.Fatal(err)
	}
	if err := service.ReplaceWorkspaceChatItems("broken", []domain.WorkspaceChatItem{
		{ID: "i1", Payload: map[string]any{"text": boundConversation}},
	}); err != nil {
		t.Fatal(err)
	}
	recovery, err := service.RecoverWorkspaceChatBinding("broken")
	if err != nil {
		t.Fatal(err)
	}
	if len(recovery.Candidates) != 1 || !recovery.Candidates[0].Conflict || recovery.Candidates[0].BoundToChatID != "owner" {
		t.Fatalf("a conversation owned elsewhere must be reported as a conflict: %+v", recovery.Candidates)
	}
}

// Recovery never writes: it proposes, and the explicit rebind applies.
func TestBindingRecoveryDoesNotRebindOnItsOwn(t *testing.T) {
	service := bindingService(t)
	root := t.TempDir()
	if _, err := service.SaveWorkspaceChat(domain.WorkspaceChat{ID: "chat-6", ProjectPath: root, SessionID: "ses-6", Title: "Broken"}); err != nil {
		t.Fatal(err)
	}
	if err := service.ReplaceWorkspaceChatItems("chat-6", []domain.WorkspaceChatItem{
		{ID: "i1", Payload: map[string]any{"text": boundConversation}},
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := service.RecoverWorkspaceChatBinding("chat-6"); err != nil {
		t.Fatal(err)
	}
	stored, err := service.store.GetWorkspaceChat("chat-6")
	if err != nil {
		t.Fatal(err)
	}
	if stored.ChatGPTURL != "" {
		t.Fatalf("recovery must not bind by itself, stored %q", stored.ChatGPTURL)
	}
}
