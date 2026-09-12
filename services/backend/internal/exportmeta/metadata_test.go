package exportmeta

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestCaptureIncludesGitStatusAndWorktreesWithoutRemotes(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not installed")
	}
	root := t.TempDir()
	run(t, root, "git", "init", "-q")
	run(t, root, "git", "config", "user.email", "test@example.invalid")
	run(t, root, "git", "config", "user.name", "Wharness Test")
	if err := os.WriteFile(filepath.Join(root, "tracked.txt"), []byte("one\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	run(t, root, "git", "add", "tracked.txt")
	run(t, root, "git", "commit", "-qm", "initial")
	run(t, root, "git", "remote", "add", "origin", "https://user:secret@example.invalid/repo.git")
	if err := os.WriteFile(filepath.Join(root, "tracked.txt"), []byte("two\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	meta := Capture(root, "test", time.Date(2026, 9, 3, 17, 0, 0, 0, time.UTC))
	text := string(meta.Markdown())
	for _, want := range []string{"## Git status", " M tracked.txt", "## Git worktrees", "worktree " + root, "Generated at (UTC)"} {
		if !strings.Contains(text, want) {
			t.Fatalf("metadata missing %q:\n%s", want, text)
		}
	}
	if strings.Contains(text, "secret@example.invalid") {
		t.Fatalf("remote URL leaked into metadata: %s", text)
	}
}

func TestSemanticSHAIgnoresGeneratedTimestamp(t *testing.T) {
	root := t.TempDir()
	first := Capture(root, "context", time.Unix(1, 0))
	second := Capture(root, "context", time.Unix(2, 0))
	if first.SemanticSHA256() != second.SemanticSHA256() {
		t.Fatal("semantic hash should ignore generation timestamp")
	}
}

func run(t *testing.T, dir, name string, args ...string) {
	t.Helper()
	cmd := exec.Command(name, args...)
	cmd.Dir = dir
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("%s %v: %v: %s", name, args, err, out)
	}
}

func TestCaptureWharnessRuntimeIncludesStatusAndBoundedRedactedLogs(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "scripts"), 0o755); err != nil {
		t.Fatal(err)
	}
	statusPath := filepath.Join(root, "scripts", "status.sh")
	if err := os.WriteFile(statusPath, []byte("#!/bin/sh\necho 'Wharness status'\necho '  backend running'\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	logDir := filepath.Join(root, ".harness", "logs")
	if err := os.MkdirAll(logDir, 0o755); err != nil {
		t.Fatal(err)
	}
	var log strings.Builder
	for i := 0; i < 205; i++ {
		fmt.Fprintf(&log, "line-%03d\n", i)
	}
	log.WriteString("OPENAI_API_KEY=sk-test-secret\n")
	log.WriteString("Authorization: Bearer private-token\n")
	if err := os.WriteFile(filepath.Join(logDir, "desktop.log"), []byte(log.String()), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(logDir, "self-evolution.log"), []byte("self-evolution restarted plan=plan-test\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	runtime := CaptureWharnessRuntime(root)
	meta := Capture(root, "make-export", time.Date(2026, 9, 3, 17, 30, 0, 0, time.UTC))
	meta.Runtime = &runtime
	text := string(meta.Markdown())
	for _, want := range []string{"## Wharnex status", "backend running", "## Wharnex recent logs", "line-204", "[REDACTED]", "## Wharnex self-evolution logs", "self-evolution restarted"} {
		if !strings.Contains(text, want) {
			t.Fatalf("runtime metadata missing %q:\n%s", want, text)
		}
	}
	if strings.Contains(text, "sk-test-secret") || strings.Contains(text, "private-token") {
		t.Fatalf("runtime secrets leaked into metadata:\n%s", text)
	}
	if strings.Contains(text, "line-000") {
		t.Fatalf("runtime log tail was not bounded:\n%s", text)
	}
}

func TestManagedContextSemanticSHAIgnoresWharnessRuntime(t *testing.T) {
	root := t.TempDir()
	meta := Capture(root, "managed-context", time.Time{})
	baseline := meta.SemanticSHA256()
	meta.Runtime = &RuntimeMetadata{Status: "running", Logs: "volatile log line"}
	if got := meta.SemanticSHA256(); got != baseline {
		t.Fatalf("runtime diagnostics must not affect managed-context semantic hash: %s != %s", got, baseline)
	}
}
