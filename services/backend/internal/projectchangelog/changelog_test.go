package projectchangelog

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func requireGit(t *testing.T) {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is not installed")
	}
}

func git(t *testing.T, dir string, args ...string) string {
	t.Helper()
	base := []string{"-C", dir, "-c", "user.name=Tester", "-c", "user.email=test@example.invalid", "-c", "commit.gpgSign=false"}
	cmd := exec.Command("git", append(base, args...)...)
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0", "GIT_CONFIG_NOSYSTEM=1")
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v: %s", args, err, output)
	}
	return strings.TrimSpace(string(output))
}

// newRepo creates a one-commit repository with the given CHANGELOG.md content,
// matching what every Wharnex project is guaranteed to be before Reserve or
// RemoveEmptyReservation ever run against it.
func newRepo(t *testing.T, changelog string) string {
	t.Helper()
	root := t.TempDir()
	git(t, root, "init", "-q", "-b", "main")
	git(t, root, "config", "user.name", "Tester")
	git(t, root, "config", "user.email", "test@example.invalid")
	if changelog != "" {
		if err := os.WriteFile(filepath.Join(root, FileName), []byte(changelog), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(root, "README.md"), []byte("root\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	git(t, root, "add", "-A")
	git(t, root, "commit", "-qm", "initial")
	return root
}

func readFile(t *testing.T, root string) string {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(root, FileName))
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

var fixedDate = time.Date(2026, 9, 20, 12, 0, 0, 0, time.UTC)

func TestEnsureCreatesDefaultWhenMissing(t *testing.T) {
	root := t.TempDir()
	created, err := Ensure(root)
	if err != nil {
		t.Fatal(err)
	}
	if !created {
		t.Fatal("expected Ensure to report creation")
	}
	data, err := os.ReadFile(filepath.Join(root, FileName))
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != DefaultContent {
		t.Fatalf("unexpected default content: %q", data)
	}
}

func TestEnsureDoesNotOverwriteExisting(t *testing.T) {
	root := t.TempDir()
	custom := "# Changelog\n\n## Unreleased\n\n- existing entry\n"
	if err := os.WriteFile(filepath.Join(root, FileName), []byte(custom), 0o644); err != nil {
		t.Fatal(err)
	}
	created, err := Ensure(root)
	if err != nil {
		t.Fatal(err)
	}
	if created {
		t.Fatal("Ensure must not report creation for an existing file")
	}
	data, err := os.ReadFile(filepath.Join(root, FileName))
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != custom {
		t.Fatalf("Ensure must not modify an existing file, got %q", data)
	}
}

func TestReserveInsertsHeadingUnderUnreleased(t *testing.T) {
	requireGit(t)
	root := newRepo(t, "## Unreleased\n\n- old entry one\n- old entry two\n")

	heading, sha, err := Reserve(context.Background(), root, "chat-a", fixedDate)
	if err != nil {
		t.Fatal(err)
	}
	wantHeading := "### Chat chat-a (2026-09-20)"
	if heading != wantHeading {
		t.Fatalf("heading = %q, want %q", heading, wantHeading)
	}
	if sha == "" {
		t.Fatal("expected a commit sha for a real reservation")
	}

	want := "## Unreleased\n### Chat chat-a (2026-09-20)\n\n_(reserved — no entries yet)_\n\n\n- old entry one\n- old entry two\n"
	if got := readFile(t, root); got != want {
		t.Fatalf("file after reserve:\n%q\nwant:\n%q", got, want)
	}
	if log := git(t, root, "log", "-1", "--format=%s"); log != "chore(changelog): reserve section for chat chat-a" {
		t.Fatalf("unexpected commit subject: %q", log)
	}
	if status := git(t, root, "status", "--porcelain"); status != "" {
		t.Fatalf("reservation must be committed, working tree still dirty: %q", status)
	}
}

func TestReserveIsIdempotentPerChat(t *testing.T) {
	requireGit(t)
	root := newRepo(t, "## Unreleased\n\n- old entry\n")

	first, sha1, err := Reserve(context.Background(), root, "chat-a", fixedDate)
	if err != nil {
		t.Fatal(err)
	}
	headBefore := git(t, root, "rev-parse", "HEAD")

	second, sha2, err := Reserve(context.Background(), root, "chat-a", fixedDate.Add(24*time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if second != first {
		t.Fatalf("second reservation for the same chat must reuse the heading: got %q want %q", second, first)
	}
	if sha2 != "" {
		t.Fatalf("second reservation must not create a new commit, got sha %q (first %q)", sha2, sha1)
	}
	if headAfter := git(t, root, "rev-parse", "HEAD"); headAfter != headBefore {
		t.Fatalf("HEAD moved on an idempotent reservation: %s -> %s", headBefore, headAfter)
	}
}

func TestReserveStacksNewestFirstWithTwoBlankLineSeparator(t *testing.T) {
	requireGit(t)
	root := newRepo(t, "## Unreleased\n\n- old entry\n")

	if _, _, err := Reserve(context.Background(), root, "chat-a", fixedDate); err != nil {
		t.Fatal(err)
	}
	if _, _, err := Reserve(context.Background(), root, "chat-b", fixedDate.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}

	want := "## Unreleased\n" +
		"### Chat chat-b (2026-09-20)\n\n_(reserved — no entries yet)_\n\n\n" +
		"### Chat chat-a (2026-09-20)\n\n_(reserved — no entries yet)_\n\n\n" +
		"- old entry\n"
	if got := readFile(t, root); got != want {
		t.Fatalf("stacked reservations:\n%q\nwant:\n%q", got, want)
	}
}

func TestReserveFallsBackToTopWithNoHeading(t *testing.T) {
	requireGit(t)
	root := newRepo(t, "- a bullet with no heading above it\n")

	heading, _, err := Reserve(context.Background(), root, "chat-a", fixedDate)
	if err != nil {
		t.Fatal(err)
	}
	want := "### Chat chat-a (2026-09-20)\n\n_(reserved — no entries yet)_\n\n\n- a bullet with no heading above it\n"
	if got := readFile(t, root); got != want {
		t.Fatalf("fallback insertion:\n%q\nwant:\n%q", got, want)
	}
	if heading != "### Chat chat-a (2026-09-20)" {
		t.Fatalf("unexpected heading %q", heading)
	}
}

func TestRemoveEmptyReservationDeletesUntouchedBlock(t *testing.T) {
	requireGit(t)
	root := newRepo(t, "## Unreleased\n\n- old entry\n")
	if _, _, err := Reserve(context.Background(), root, "chat-a", fixedDate); err != nil {
		t.Fatal(err)
	}

	removed, err := RemoveEmptyReservation(context.Background(), root, "chat-a")
	if err != nil {
		t.Fatal(err)
	}
	if !removed {
		t.Fatal("expected the untouched reservation to be removed")
	}
	want := "## Unreleased\n- old entry\n"
	if got := readFile(t, root); got != want {
		t.Fatalf("after removal:\n%q\nwant:\n%q", got, want)
	}
	if status := git(t, root, "status", "--porcelain"); status != "" {
		t.Fatalf("removal must be committed, working tree still dirty: %q", status)
	}
}

func TestRemoveEmptyReservationLeavesRealContentAlone(t *testing.T) {
	requireGit(t)
	root := newRepo(t, "## Unreleased\n\n- old entry\n")
	if _, _, err := Reserve(context.Background(), root, "chat-a", fixedDate); err != nil {
		t.Fatal(err)
	}
	// Simulate a planner having written a real entry under its reserved
	// heading: replace the placeholder with actual content.
	before := readFile(t, root)
	after := strings.Replace(before, placeholderBody, "- fix(auth): keep the session alive", 1)
	if err := os.WriteFile(filepath.Join(root, FileName), []byte(after), 0o644); err != nil {
		t.Fatal(err)
	}
	git(t, root, "add", "-A")
	git(t, root, "commit", "-qm", "feat: real entry")

	removed, err := RemoveEmptyReservation(context.Background(), root, "chat-a")
	if err != nil {
		t.Fatal(err)
	}
	if removed {
		t.Fatal("a reservation carrying real content must never be removed")
	}
	if got := readFile(t, root); got != after {
		t.Fatalf("file must stay untouched, got:\n%q\nwant:\n%q", got, after)
	}
}

func TestRemoveEmptyReservationNoOpWithoutChangelog(t *testing.T) {
	root := t.TempDir()
	removed, err := RemoveEmptyReservation(context.Background(), root, "chat-a")
	if err != nil {
		t.Fatal(err)
	}
	if removed {
		t.Fatal("expected no-op when CHANGELOG.md does not exist")
	}
}

func TestRemoveEmptyReservationNoOpForUnknownChat(t *testing.T) {
	requireGit(t)
	root := newRepo(t, "## Unreleased\n\n- old entry\n")
	if _, _, err := Reserve(context.Background(), root, "chat-a", fixedDate); err != nil {
		t.Fatal(err)
	}
	removed, err := RemoveEmptyReservation(context.Background(), root, "chat-does-not-exist")
	if err != nil {
		t.Fatal(err)
	}
	if removed {
		t.Fatal("removing an unknown chat id must be a no-op")
	}
}

// TestRemoveEmptyReservationPreservesNeighborBlocks is the boundary-finding
// guarantee this package exists for: deleting one empty middle block must not
// eat a single byte of the still-open blocks on either side of it.
func TestRemoveEmptyReservationPreservesNeighborBlocks(t *testing.T) {
	requireGit(t)
	root := newRepo(t, "## Unreleased\n\n- legacy entry\n")

	// Newest-first stacking: reserve a (oldest), then b (middle), then c
	// (newest) so the file reads c, b, a, legacy.
	if _, _, err := Reserve(context.Background(), root, "chat-a", fixedDate); err != nil {
		t.Fatal(err)
	}
	if _, _, err := Reserve(context.Background(), root, "chat-b", fixedDate); err != nil {
		t.Fatal(err)
	}
	if _, _, err := Reserve(context.Background(), root, "chat-c", fixedDate); err != nil {
		t.Fatal(err)
	}

	// Give chat-a and chat-c real content so only chat-b (the middle block)
	// is still empty and eligible for removal.
	content := readFile(t, root)
	content = strings.Replace(content, "### Chat chat-a (2026-09-20)\n\n"+placeholderBody,
		"### Chat chat-a (2026-09-20)\n\n- a's real entry", 1)
	content = strings.Replace(content, "### Chat chat-c (2026-09-20)\n\n"+placeholderBody,
		"### Chat chat-c (2026-09-20)\n\n- c's real entry", 1)
	if err := os.WriteFile(filepath.Join(root, FileName), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	git(t, root, "add", "-A")
	git(t, root, "commit", "-qm", "feat: a and c wrote real entries")

	removed, err := RemoveEmptyReservation(context.Background(), root, "chat-b")
	if err != nil {
		t.Fatal(err)
	}
	if !removed {
		t.Fatal("expected chat-b's untouched reservation to be removed")
	}

	got := readFile(t, root)
	if strings.Contains(got, "chat-b") {
		t.Fatalf("chat-b's block must be fully gone, got:\n%s", got)
	}
	if !strings.Contains(got, "### Chat chat-c (2026-09-20)\n\n- c's real entry") {
		t.Fatalf("chat-c's block must survive intact, got:\n%s", got)
	}
	if !strings.Contains(got, "### Chat chat-a (2026-09-20)\n\n- a's real entry") {
		t.Fatalf("chat-a's block must survive intact, got:\n%s", got)
	}
	// Exactly two blank lines must still separate c's block from a's block.
	want := "## Unreleased\n" +
		"### Chat chat-c (2026-09-20)\n\n- c's real entry\n\n\n" +
		"### Chat chat-a (2026-09-20)\n\n- a's real entry\n\n\n" +
		"- legacy entry\n"
	if got != want {
		t.Fatalf("after removing the middle block:\n%q\nwant:\n%q", got, want)
	}
}

func TestRenderPromptSectionEmptyWithoutHeading(t *testing.T) {
	if section := RenderPromptSection(""); section != "" {
		t.Fatalf("expected empty section, got %q", section)
	}
	if section := RenderPromptSection("   "); section != "" {
		t.Fatalf("expected empty section for blank heading, got %q", section)
	}
}

func TestRenderPromptSectionNamesTheExactHeading(t *testing.T) {
	section := RenderPromptSection("### Chat chat-a (2026-09-20)")
	if !strings.Contains(section, "### Chat chat-a (2026-09-20)") {
		t.Fatalf("section must quote the exact heading, got %q", section)
	}
	if !strings.Contains(section, FileName) {
		t.Fatalf("section must name %s, got %q", FileName, section)
	}
}

func TestHeadingFormat(t *testing.T) {
	got := Heading(" chat-a ", fixedDate)
	want := "### Chat chat-a (2026-09-20)"
	if got != want {
		t.Fatalf("Heading() = %q, want %q", got, want)
	}
}
