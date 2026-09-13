package session

import (
	"testing"
	"time"

	"kernl.local/harness/backend/internal/domain"
)

const (
	testProjectA = "/home/op/workspace/alpha"
	testProjectB = "/home/op/workspace/beta"
)

func seedWorkspaceChat(t *testing.T, store *Store, chatID, projectPath string) {
	t.Helper()
	if err := store.SaveWorkspaceChat(domain.WorkspaceChat{ID: chatID, ProjectPath: projectPath}); err != nil {
		t.Fatal(err)
	}
}

func enqueue(t *testing.T, store *Store, task ChatAgentTask) ChatAgentTask {
	t.Helper()
	stored, err := store.EnqueueChatAgentTask(task)
	if err != nil {
		t.Fatal(err)
	}
	return stored
}

// A caller that supplies no project must still produce attributable work, or
// the task panel of the project that created it cannot show it.
func TestEnqueueResolvesProjectFromWorkspaceChat(t *testing.T) {
	store := NewStore()
	seedWorkspaceChat(t, store, "chat-a", testProjectA)

	stored := enqueue(t, store, testChatAgentTask("AWAIT_RESPONSE", "chat-a", "conv-a", "await:req-1"))
	if stored.ProjectID != testProjectA {
		t.Fatalf("project_id=%q want %q", stored.ProjectID, testProjectA)
	}
}

// The Desktop transport passed the ChatGPT project *display name* here. It is a
// remote label the operator can rename from ChatGPT's own UI, so storing it
// produced a value that matched no project filter yet was indistinguishable
// from a deliberate attribution.
func TestEnqueueDiscardsNonPathProjectAndResolvesFromChat(t *testing.T) {
	store := NewStore()
	seedWorkspaceChat(t, store, "chat-a", testProjectA)

	task := testChatAgentTask("BOT_WRITE", "chat-a", "conv-a", "")
	task.ProjectID = "WHX: Alpha"
	stored := enqueue(t, store, task)
	if stored.ProjectID != testProjectA {
		t.Fatalf("project_id=%q want %q", stored.ProjectID, testProjectA)
	}
}

// The translation utility enqueues with the session id in both fields and no
// workspace chat row at all.
func TestEnqueueResolvesProjectFromSession(t *testing.T) {
	store := NewStore()
	if err := store.Put(domain.Session{ID: "ses-1", ProjectPath: testProjectB}); err != nil {
		t.Fatal(err)
	}

	task := testChatAgentTask("TRANSLATE_MARKDOWN", "ses-1", "", "")
	task.SessionID = "ses-1"
	stored := enqueue(t, store, task)
	if stored.ProjectID != testProjectB {
		t.Fatalf("project_id=%q want %q", stored.ProjectID, testProjectB)
	}
}

// An unresolvable task belongs to no project. Guessing one would put this
// project's work on another project's screen, which is the defect being fixed.
func TestEnqueueLeavesUnresolvableProjectEmpty(t *testing.T) {
	store := NewStore()
	stored := enqueue(t, store, testChatAgentTask("AWAIT_RESPONSE", "chat-unknown", "conv-x", "await:req-9"))
	if stored.ProjectID != "" {
		t.Fatalf("project_id=%q want empty", stored.ProjectID)
	}
}

// Request-bound work for a project nobody has open cannot be supervised: the
// operator cannot see its chat, read its response or act when it needs
// attention. It waits rather than competing for the shared pool.
func TestClaimSkipsTaskOfClosedProject(t *testing.T) {
	store := NewStore()
	seedWorkspaceChat(t, store, "chat-a", testProjectA)
	enqueue(t, store, testChatAgentTask("AWAIT_RESPONSE", "chat-a", "conv-a", "await:req-1"))

	claimed, err := store.ClaimChatAgentTaskWithOptions("worker-1", 45*time.Second, ChatAgentClaimOptions{
		ProjectScoped: true, OpenProjects: []string{testProjectB},
	})
	if err != nil {
		t.Fatal(err)
	}
	if claimed != nil {
		t.Fatalf("claimed %s for a project no window has open", claimed.Type)
	}
}

func TestClaimAdmitsTaskOfOpenProject(t *testing.T) {
	store := NewStore()
	seedWorkspaceChat(t, store, "chat-a", testProjectA)
	enqueue(t, store, testChatAgentTask("AWAIT_RESPONSE", "chat-a", "conv-a", "await:req-1"))

	claimed, err := store.ClaimChatAgentTaskWithOptions("worker-1", 45*time.Second, ChatAgentClaimOptions{
		ProjectScoped: true, OpenProjects: []string{testProjectB, testProjectA},
	})
	if err != nil {
		t.Fatal(err)
	}
	if claimed == nil || claimed.Type != "AWAIT_RESPONSE" {
		t.Fatalf("claimed=%v want the open project's supervision", claimed)
	}
}

// Account-lifecycle work acts on the ChatGPT account, not on the project. The
// chat-deletion convergence rule requires it to reach the remote conversation
// and its bundles whatever happens to be open, or the operator's account keeps
// conversations and files they explicitly asked to be removed.
func TestClaimAdmitsAccountLifecycleWorkOfClosedProject(t *testing.T) {
	store := NewStore()
	seedWorkspaceChat(t, store, "chat-a", testProjectA)
	enqueue(t, store, testChatAgentTask("DELETE_BUNDLE", "chat-a", "conv-a", "delete-bundle:a.zip"))

	claimed, err := store.ClaimChatAgentTaskWithOptions("worker-1", 45*time.Second, ChatAgentClaimOptions{
		ProjectScoped: true, OpenProjects: []string{testProjectB},
	})
	if err != nil {
		t.Fatal(err)
	}
	if claimed == nil || claimed.Type != "DELETE_BUNDLE" {
		t.Fatalf("claimed=%v want account cleanup to converge regardless", claimed)
	}
}

// No project open is not the same instruction as "this caller cannot scope".
func TestClaimWithNoOpenProjectsStillDrainsUnattributedWork(t *testing.T) {
	store := NewStore()
	enqueue(t, store, testChatAgentTask("AWAIT_RESPONSE", "chat-unknown", "conv-x", "await:req-9"))

	claimed, err := store.ClaimChatAgentTaskWithOptions("worker-1", 45*time.Second, ChatAgentClaimOptions{
		ProjectScoped: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if claimed == nil {
		t.Fatal("a task belonging to no project is blocked by no project")
	}
}

// An unscoped caller — the web/dev path — claims exactly as before.
func TestUnscopedClaimIgnoresProjectAttribution(t *testing.T) {
	store := NewStore()
	seedWorkspaceChat(t, store, "chat-a", testProjectA)
	enqueue(t, store, testChatAgentTask("AWAIT_RESPONSE", "chat-a", "conv-a", "await:req-1"))

	claimed, err := store.ClaimChatAgentTaskWithOptions("worker-1", 45*time.Second, ChatAgentClaimOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if claimed == nil {
		t.Fatal("an unscoped claim must keep its previous behavior")
	}
}

// The panel's counters and its cards must describe the same queue.
func TestQueueSummaryScopesToProjectAndCountsTheRest(t *testing.T) {
	store := NewStore()
	seedWorkspaceChat(t, store, "chat-a", testProjectA)
	seedWorkspaceChat(t, store, "chat-b", testProjectB)
	enqueue(t, store, testChatAgentTask("AWAIT_RESPONSE", "chat-a", "conv-a", "await:req-1"))
	enqueue(t, store, testChatAgentTask("AWAIT_RESPONSE", "chat-b", "conv-b", "await:req-2"))
	enqueue(t, store, testChatAgentTask("BOT_WRITE", "chat-b", "conv-b", ""))

	summary, err := store.ChatAgentQueueSummary(testProjectA)
	if err != nil {
		t.Fatal(err)
	}
	if summary.Queued != 1 || summary.Due != 1 {
		t.Fatalf("queued=%d due=%d want 1/1", summary.Queued, summary.Due)
	}
	if summary.OtherProjects != 2 {
		t.Fatalf("other_projects=%d want 2", summary.OtherProjects)
	}
}

func TestListChatAgentTasksScopesToProject(t *testing.T) {
	store := NewStore()
	seedWorkspaceChat(t, store, "chat-a", testProjectA)
	seedWorkspaceChat(t, store, "chat-b", testProjectB)
	enqueue(t, store, testChatAgentTask("AWAIT_RESPONSE", "chat-a", "conv-a", "await:req-1"))
	enqueue(t, store, testChatAgentTask("AWAIT_RESPONSE", "chat-b", "conv-b", "await:req-2"))

	items, err := store.ListChatAgentTasks(ChatAgentTaskFilter{ProjectID: testProjectA, ActiveOnly: true})
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].ChatID != "chat-a" {
		t.Fatalf("items=%v want only project A's task", items)
	}
}

// Degrading an unusable project filter to "no filter" would widen one
// project's panel to the whole account. It fails closed instead.
func TestListChatAgentTasksFailsClosedOnUnusableProjectFilter(t *testing.T) {
	store := NewStore()
	seedWorkspaceChat(t, store, "chat-a", testProjectA)
	enqueue(t, store, testChatAgentTask("AWAIT_RESPONSE", "chat-a", "conv-a", "await:req-1"))

	items, err := store.ListChatAgentTasks(ChatAgentTaskFilter{ProjectID: "WHX: Alpha", ActiveOnly: true})
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 0 {
		t.Fatalf("items=%d want 0", len(items))
	}
	summary, err := store.ChatAgentQueueSummary("WHX: Alpha")
	if err != nil {
		t.Fatal(err)
	}
	if summary.Queued != 0 {
		t.Fatalf("queued=%d want 0", summary.Queued)
	}
}
