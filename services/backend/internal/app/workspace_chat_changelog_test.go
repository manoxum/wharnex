package app

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/projectchangelog"
)

// gitOutputForApp runs a read-only git command and returns its trimmed
// output, for assertions that need to see what a mutation actually produced
// rather than only that it succeeded.
func gitOutputForApp(t *testing.T, dir string, args ...string) string {
	t.Helper()
	base := []string{"-C", dir, "-c", "user.name=Tester", "-c", "user.email=test@example.invalid"}
	cmd := exec.Command("git", append(base, args...)...)
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v: %s", args, err, output)
	}
	return strings.TrimSpace(string(output))
}

// changelogRepo builds a one-commit Git repository whose CHANGELOG.md already
// follows this repository's own real convention (a top "## Unreleased"
// heading), matching what projectchangelog.Ensure leaves a brand-new project
// with.
func changelogRepo(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	runGitForApp(t, root, "init", "-q", "-b", "main")
	runGitForApp(t, root, "config", "user.name", "Tester")
	runGitForApp(t, root, "config", "user.email", "test@example.invalid")
	if err := os.WriteFile(filepath.Join(root, projectchangelog.FileName), []byte(projectchangelog.DefaultContent), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "README.md"), []byte("root\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	runGitForApp(t, root, "add", "-A")
	runGitForApp(t, root, "commit", "-qm", "initial")
	return root
}

func readChangelog(t *testing.T, root string) string {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(root, projectchangelog.FileName))
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

// eventuallyChanged polls until fn returns true or the deadline passes. The
// archive cleanup runs off its own goroutine (SetWorkspaceChatArchived must
// stay an instant flip per ADR-0031), so a test observing its effect has to
// wait for it rather than assert immediately after the call returns.
func eventuallyChanged(t *testing.T, fn func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if fn() {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	if !fn() {
		t.Fatal("condition did not become true before the deadline")
	}
}

func TestSaveWorkspaceChatReservesChangelogSectionForNewChat(t *testing.T) {
	requireGitForApp(t)
	service := bindingService(t)
	root := changelogRepo(t)

	saved, err := service.SaveWorkspaceChat(domain.WorkspaceChat{ID: "chat-new", ProjectPath: root, SessionID: "ses-new", Title: "First"})
	if err != nil {
		t.Fatal(err)
	}
	if saved.ChangelogHeading == "" {
		t.Fatal("expected a reserved changelog heading on a brand-new chat")
	}
	if !strings.HasPrefix(saved.ChangelogHeading, "### Chat chat-new (") {
		t.Fatalf("unexpected heading shape: %q", saved.ChangelogHeading)
	}
	content := readChangelog(t, root)
	if !strings.Contains(content, saved.ChangelogHeading) {
		t.Fatalf("CHANGELOG.md does not contain the reserved heading:\n%s", content)
	}
	if log := runGitLog(t, root); !strings.Contains(log, "chore(changelog): reserve section for chat chat-new") {
		t.Fatalf("expected an internal reservation commit, got log:\n%s", log)
	}
	if status := runGitStatus(t, root); status != "" {
		t.Fatalf("reservation must be committed, working tree still dirty: %q", status)
	}

	// The persisted row must agree with what SaveWorkspaceChat returned.
	stored, err := service.store.GetWorkspaceChat("chat-new")
	if err != nil {
		t.Fatal(err)
	}
	if stored.ChangelogHeading != saved.ChangelogHeading {
		t.Fatalf("stored heading %q does not match returned heading %q", stored.ChangelogHeading, saved.ChangelogHeading)
	}
}

func TestSaveWorkspaceChatDoesNotReReserveOnOrdinaryUpdate(t *testing.T) {
	requireGitForApp(t)
	service := bindingService(t)
	root := changelogRepo(t)

	first, err := service.SaveWorkspaceChat(domain.WorkspaceChat{ID: "chat-a", ProjectPath: root, SessionID: "ses-a", Title: "First"})
	if err != nil {
		t.Fatal(err)
	}
	headBefore := headOf(t, root)

	second, err := service.SaveWorkspaceChat(domain.WorkspaceChat{ID: "chat-a", ProjectPath: root, SessionID: "ses-a", Title: "Retitled"})
	if err != nil {
		t.Fatal(err)
	}
	if second.ChangelogHeading != first.ChangelogHeading {
		t.Fatalf("an ordinary update must preserve the reserved heading: got %q want %q", second.ChangelogHeading, first.ChangelogHeading)
	}
	if headAfter := headOf(t, root); headAfter != headBefore {
		t.Fatalf("an ordinary update must not touch CHANGELOG.md again: HEAD moved %s -> %s", headBefore, headAfter)
	}
}

func TestSaveWorkspaceChatSkipsReservationWithoutGitRepository(t *testing.T) {
	service := bindingService(t)
	root := t.TempDir() // no `git init`, matching every pre-existing chat fixture

	saved, err := service.SaveWorkspaceChat(domain.WorkspaceChat{ID: "chat-nogit", ProjectPath: root, SessionID: "ses-nogit", Title: "First"})
	if err != nil {
		t.Fatalf("reservation failure must never fail an ordinary chat save: %v", err)
	}
	if saved.ChangelogHeading != "" {
		t.Fatalf("expected no reservation without a Git repository, got %q", saved.ChangelogHeading)
	}
}

func TestArchivingChatRemovesUntouchedChangelogReservation(t *testing.T) {
	requireGitForApp(t)
	service := bindingService(t)
	root := changelogRepo(t)

	saved, err := service.SaveWorkspaceChat(domain.WorkspaceChat{ID: "chat-empty", ProjectPath: root, SessionID: "ses-empty", Title: "First"})
	if err != nil {
		t.Fatal(err)
	}
	heading := saved.ChangelogHeading
	if heading == "" {
		t.Fatal("expected a reservation to archive against")
	}

	if _, err := service.SetWorkspaceChatArchived("chat-empty", true); err != nil {
		t.Fatal(err)
	}

	eventuallyChanged(t, func() bool {
		return !strings.Contains(readChangelog(t, root), heading)
	})
	eventuallyChanged(t, func() bool {
		chat, err := service.store.GetWorkspaceChat("chat-empty")
		return err == nil && chat.ChangelogHeading == ""
	})
}

func TestArchivingChatKeepsChangelogReservationWithRealContent(t *testing.T) {
	requireGitForApp(t)
	service := bindingService(t)
	root := changelogRepo(t)

	saved, err := service.SaveWorkspaceChat(domain.WorkspaceChat{ID: "chat-real", ProjectPath: root, SessionID: "ses-real", Title: "First"})
	if err != nil {
		t.Fatal(err)
	}
	heading := saved.ChangelogHeading

	// Simulate the planner having written a real entry under its own heading.
	before := readChangelog(t, root)
	after := strings.Replace(before, "_(reserved — no entries yet)_", "- fix(auth): keep the session alive", 1)
	if after == before {
		t.Fatal("fixture did not contain the expected placeholder")
	}
	if err := os.WriteFile(filepath.Join(root, projectchangelog.FileName), []byte(after), 0o644); err != nil {
		t.Fatal(err)
	}
	runGitForApp(t, root, "add", "-A")
	runGitForApp(t, root, "commit", "-qm", "feat: real entry")

	if _, err := service.SetWorkspaceChatArchived("chat-real", true); err != nil {
		t.Fatal(err)
	}

	// Give the async cleanup a fair chance to run, then assert it left the
	// real content alone: the heading and its content must both survive.
	time.Sleep(200 * time.Millisecond)
	content := readChangelog(t, root)
	if !strings.Contains(content, heading) || !strings.Contains(content, "fix(auth): keep the session alive") {
		t.Fatalf("archiving must never remove a reservation carrying real content, got:\n%s", content)
	}
}

func TestRestoringArchivedChatWithoutAReservationGetsAFreshOne(t *testing.T) {
	requireGitForApp(t)
	service := bindingService(t)
	root := changelogRepo(t)

	saved, err := service.SaveWorkspaceChat(domain.WorkspaceChat{ID: "chat-restore", ProjectPath: root, SessionID: "ses-restore", Title: "First"})
	if err != nil {
		t.Fatal(err)
	}
	firstHeading := saved.ChangelogHeading

	if _, err := service.SetWorkspaceChatArchived("chat-restore", true); err != nil {
		t.Fatal(err)
	}
	eventuallyChanged(t, func() bool {
		chat, err := service.store.GetWorkspaceChat("chat-restore")
		return err == nil && chat.ChangelogHeading == ""
	})

	restored, err := service.SetWorkspaceChatArchived("chat-restore", false)
	if err != nil {
		t.Fatal(err)
	}
	if restored.ChangelogHeading == "" {
		t.Fatal("expected a fresh reservation on restore after the old one was cleaned up")
	}
	if !strings.Contains(readChangelog(t, root), restored.ChangelogHeading) {
		t.Fatalf("restored heading %q is not present in CHANGELOG.md", restored.ChangelogHeading)
	}
	_ = firstHeading // the exact old heading text is not asserted; only that a working one exists now
}

func TestChangelogPromptSectionNamesTheReservedHeading(t *testing.T) {
	requireGitForApp(t)
	service := bindingService(t)
	root := changelogRepo(t)

	saved, err := service.SaveWorkspaceChat(domain.WorkspaceChat{ID: "chat-prompt", ProjectPath: root, SessionID: "ses-prompt", Title: "First"})
	if err != nil {
		t.Fatal(err)
	}

	section := service.changelogPromptSection("chat-prompt")
	if !strings.Contains(section, saved.ChangelogHeading) {
		t.Fatalf("prompt section must quote the reserved heading, got %q", section)
	}

	if section := service.changelogPromptSection(""); section != "" {
		t.Fatalf("expected no section for an empty chat id, got %q", section)
	}
	if section := service.changelogPromptSection("unknown-chat"); section != "" {
		t.Fatalf("expected no section for a chat with no reservation, got %q", section)
	}
}

func runGitLog(t *testing.T, root string) string {
	t.Helper()
	return gitOutputForApp(t, root, "log", "--format=%s")
}

func runGitStatus(t *testing.T, root string) string {
	t.Helper()
	return gitOutputForApp(t, root, "status", "--porcelain")
}

// TestConcurrentChatCreationReservesDisjointSections is the concurrency claim
// this whole mechanism exists to prove: two chats starting at the same instant
// on the same project must not race each other's Git commit. Reusing the
// project's own apply lock means they serialize instead — briefly queuing
// rather than corrupting or losing one reservation.
func TestConcurrentChatCreationReservesDisjointSections(t *testing.T) {
	requireGitForApp(t)
	service := bindingService(t)
	root := changelogRepo(t)

	const chatCount = 6
	headings := make([]string, chatCount)
	errs := make([]error, chatCount)
	done := make(chan int, chatCount)
	for i := 0; i < chatCount; i++ {
		go func(i int) {
			defer func() { done <- i }()
			chatID := "concurrent-chat-" + string(rune('a'+i))
			saved, err := service.SaveWorkspaceChat(domain.WorkspaceChat{ID: chatID, ProjectPath: root, SessionID: chatID, Title: "New"})
			headings[i] = saved.ChangelogHeading
			errs[i] = err
		}(i)
	}
	for i := 0; i < chatCount; i++ {
		<-done
	}

	seen := make(map[string]bool, chatCount)
	for i, err := range errs {
		if err != nil {
			t.Fatalf("chat %d: %v", i, err)
		}
		if headings[i] == "" {
			t.Fatalf("chat %d: expected a reservation", i)
		}
		if seen[headings[i]] {
			t.Fatalf("two chats ended up with the same heading: %q", headings[i])
		}
		seen[headings[i]] = true
	}

	content := readChangelog(t, root)
	for _, heading := range headings {
		if !strings.Contains(content, heading) {
			t.Fatalf("CHANGELOG.md is missing a reservation that was reported saved: %q\n%s", heading, content)
		}
	}
	if status := runGitStatus(t, root); status != "" {
		t.Fatalf("every reservation must be committed, working tree still dirty: %q", status)
	}
}
