package sandbox

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// A continuation request's whole value is telling the planner exactly which
// paths moved and in which direction. A report that called a deletion a
// modification would send it looking for content that is gone.
func TestDiffBetweenReportsStatusAndLineCounts(t *testing.T) {
	requireGit(t)
	host := newTestHostRepo(t, "kept.txt", "one\n")
	write(t, host, "removed.txt", "gone\n")
	mustGit(t, host, "add", "removed.txt")
	mustGit(t, host, "-c", "user.name=T", "-c", "user.email=t@example.invalid", "commit", "-qm", "base")
	base := mustGit(t, host, "rev-parse", "HEAD")

	write(t, host, "kept.txt", "one\ntwo\nthree\n")
	if err := os.Remove(filepath.Join(host, "removed.txt")); err != nil {
		t.Fatal(err)
	}
	write(t, host, "added.txt", "new\n")
	mustGit(t, host, "add", "-A")
	mustGit(t, host, "-c", "user.name=T", "-c", "user.email=t@example.invalid", "commit", "-qm", "advance")
	head := mustGit(t, host, "rev-parse", "HEAD")

	files, err := DiffBetween(context.Background(), host, base, head)
	if err != nil {
		t.Fatalf("DiffBetween: %v", err)
	}
	byPath := map[string]DeltaFile{}
	for _, file := range files {
		byPath[file.Path] = file
	}
	if got := byPath["kept.txt"]; got.Status != "modified" || got.Additions != 2 || got.Deletions != 0 {
		t.Fatalf("kept.txt: got %+v", got)
	}
	if got := byPath["added.txt"]; got.Status != "added" {
		t.Fatalf("added.txt: got %+v", got)
	}
	if got := byPath["removed.txt"]; got.Status != "deleted" {
		t.Fatalf("removed.txt: got %+v", got)
	}
}

// Identical revisions are the common case on a healthy repair round, and the
// planner acts on that answer: it means a patch that failed to apply did not
// fail because the tree moved.
func TestDiffBetweenReportsNothingForIdenticalRevisions(t *testing.T) {
	requireGit(t)
	host := newTestHostRepo(t, "a.txt", "x\n")
	head := mustGit(t, host, "rev-parse", "HEAD")

	files, err := DiffBetween(context.Background(), host, head, head)
	if err != nil {
		t.Fatalf("DiffBetween: %v", err)
	}
	if len(files) != 0 {
		t.Fatalf("expected no divergence, got %+v", files)
	}
}

// Half a hunk is not a patch. An oversized diff must be refused outright so the
// planner is told to read the named files instead of being handed a truncation
// it would author a correction against.
func TestDiffPatchBetweenRefusesRatherThanTruncates(t *testing.T) {
	requireGit(t)
	host := newTestHostRepo(t, "a.txt", "x\n")
	base := mustGit(t, host, "rev-parse", "HEAD")
	write(t, host, "a.txt", strings.Repeat("padding line\n", 400))
	mustGit(t, host, "add", "a.txt")
	mustGit(t, host, "-c", "user.name=T", "-c", "user.email=t@example.invalid", "commit", "-qm", "grow")
	head := mustGit(t, host, "rev-parse", "HEAD")

	if _, ok, err := DiffPatchBetween(context.Background(), host, base, head, 128, nil); err != nil || ok {
		t.Fatalf("expected refusal for an oversized diff, got ok=%t err=%v", ok, err)
	}
	patch, ok, err := DiffPatchBetween(context.Background(), host, base, head, 1<<20, nil)
	if err != nil || !ok {
		t.Fatalf("expected the diff within budget, got ok=%t err=%v", ok, err)
	}
	if !strings.Contains(patch, "diff --git a/a.txt b/a.txt") {
		t.Fatalf("expected a unified diff, got:\n%s", patch)
	}
}

// Wharnex-managed project state is transported by its own protocol and cannot
// be planner-patched, so letting it into a divergence report only invites edits
// the validator then rejects every round.
func TestDiffPatchBetweenHonorsExclusions(t *testing.T) {
	requireGit(t)
	host := newTestHostRepo(t, "a.txt", "x\n")
	base := mustGit(t, host, "rev-parse", "HEAD")
	if err := os.MkdirAll(filepath.Join(host, ".wharnex", "knowledge"), 0o755); err != nil {
		t.Fatal(err)
	}
	write(t, host, filepath.Join(".wharnex", "knowledge", "note.md"), "managed\n")
	write(t, host, "a.txt", "y\n")
	mustGit(t, host, "add", "-A")
	mustGit(t, host, "-c", "user.name=T", "-c", "user.email=t@example.invalid", "commit", "-qm", "advance")
	head := mustGit(t, host, "rev-parse", "HEAD")

	patch, ok, err := DiffPatchBetween(context.Background(), host, base, head, 1<<20, []string{".wharnex/knowledge"})
	if err != nil || !ok {
		t.Fatalf("DiffPatchBetween: ok=%t err=%v", ok, err)
	}
	if strings.Contains(patch, ".wharnex/knowledge") {
		t.Fatalf("managed knowledge leaked into the divergence patch:\n%s", patch)
	}
	if !strings.Contains(patch, "a/a.txt") {
		t.Fatalf("expected the ordinary path to survive exclusion:\n%s", patch)
	}
}

func write(t *testing.T, root, name, content string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(root, name), []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}
