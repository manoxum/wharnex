package app

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSanitizeInteractiveOutputRedactsSecretsAndTruncates(t *testing.T) {
	input := "token=super-secret password:also-secret\n" + strings.Repeat("x", interactiveOutputLimit)
	got, truncated, redacted := sanitizeInteractiveOutput(input)
	if !truncated {
		t.Fatal("expected oversized interactive output to be truncated")
	}
	if !redacted {
		t.Fatal("expected common secret assignments to be redacted")
	}
	if strings.Contains(got, "super-secret") || strings.Contains(got, "also-secret") {
		t.Fatalf("redacted output leaked a secret: %q", got[:min(len(got), 160)])
	}
	if !strings.HasSuffix(got, "…[truncated]") {
		t.Fatalf("expected explicit truncation marker, got suffix %q", got[max(0, len(got)-32):])
	}
}

func TestSafeInteractiveWorkspaceCwdRejectsTraversal(t *testing.T) {
	root := t.TempDir()
	if _, err := safeInteractiveWorkspaceCwd(root, "../outside"); err == nil {
		t.Fatal("expected parent traversal to be rejected")
	}
	got, err := safeInteractiveWorkspaceCwd(root, "logs/current")
	if err != nil {
		t.Fatal(err)
	}
	if want := filepath.Join(root, "logs", "current"); got != want {
		t.Fatalf("unexpected scoped cwd %q, want %q", got, want)
	}
}

func TestResolveInteractivePathRejectsSymlinkEscape(t *testing.T) {
	root := t.TempDir()
	approved := filepath.Join(root, "approved")
	outside := t.TempDir()
	if err := os.MkdirAll(approved, 0o755); err != nil {
		t.Fatal(err)
	}
	outsideFile := filepath.Join(outside, "secret.txt")
	if err := os.WriteFile(outsideFile, []byte("secret"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outsideFile, filepath.Join(approved, "escape")); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	if _, err := resolveInteractivePath(root, filepath.Join("approved", "escape"), []string{"approved"}, false); err == nil {
		t.Fatal("expected symlink escaping approved scope to be rejected")
	}
}
