package sandbox

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

// commitOnBranch writes content and commits it on a branch rooted at from.
func commitOnBranch(t *testing.T, repo, branch, from, file, content string) {
	t.Helper()
	mustGit(t, repo, "checkout", "-q", "-B", branch, from)
	if err := os.WriteFile(filepath.Join(repo, file), []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	mustGit(t, repo, "add", file)
	mustGit(t, repo, "-c", "user.name=T", "-c", "user.email=t@example.invalid", "commit", "-qm", branch)
}

func TestPreflightMergeReportsCleanDisjointChange(t *testing.T) {
	requireGit(t)
	repo := newTestHostRepo(t, "a.txt", "one\ntwo\nthree\n")
	base := mustGit(t, repo, "rev-parse", "HEAD")
	commitOnBranch(t, repo, "peer", base, "a.txt", "one\nPEER\nthree\n")
	commitOnBranch(t, repo, "candidate", base, "b.txt", "unrelated\n")

	result, err := PreflightMerge(context.Background(), repo, "peer", "candidate")
	if err != nil {
		t.Fatalf("preflight: %v", err)
	}
	if !result.Supported {
		t.Skip("git build does not support merge-tree --write-tree")
	}
	if !result.Clean {
		t.Fatalf("expected a clean preflight, got conflicts on %v", result.ConflictPaths)
	}
}

// Two edits to the same region of the same file — the CHANGELOG.md shape that
// every concurrent request reproduces — is the case a merge genuinely cannot
// resolve, and the one that must be reported with its exact paths.
func TestPreflightMergeNamesConflictingPaths(t *testing.T) {
	requireGit(t)
	repo := newTestHostRepo(t, "CHANGELOG.md", "# Changelog\n\n## old\n")
	base := mustGit(t, repo, "rev-parse", "HEAD")
	commitOnBranch(t, repo, "peer", base, "CHANGELOG.md", "# Changelog\n\n## PEER\n\n## old\n")
	commitOnBranch(t, repo, "candidate", base, "CHANGELOG.md", "# Changelog\n\n## OURS\n\n## old\n")

	result, err := PreflightMerge(context.Background(), repo, "peer", "candidate")
	if err != nil {
		t.Fatalf("preflight: %v", err)
	}
	if !result.Supported {
		t.Skip("git build does not support merge-tree --write-tree")
	}
	if result.Clean {
		t.Fatal("expected a conflicting preflight")
	}
	if len(result.ConflictPaths) != 1 || result.ConflictPaths[0] != "CHANGELOG.md" {
		t.Fatalf("expected CHANGELOG.md to be named, got %v", result.ConflictPaths)
	}
}

// The preflight must never mutate the repository it inspects: it is allowed to
// run while other work is in flight precisely because it touches nothing.
func TestPreflightMergeLeavesRepositoryUntouched(t *testing.T) {
	requireGit(t)
	repo := newTestHostRepo(t, "a.txt", "one\n")
	base := mustGit(t, repo, "rev-parse", "HEAD")
	commitOnBranch(t, repo, "peer", base, "a.txt", "peer\n")
	commitOnBranch(t, repo, "candidate", base, "a.txt", "ours\n")
	mustGit(t, repo, "checkout", "-q", "peer")

	headBefore := mustGit(t, repo, "rev-parse", "HEAD")
	statusBefore := mustGit(t, repo, "status", "--porcelain")
	refsBefore := mustGit(t, repo, "show-ref")

	if _, err := PreflightMerge(context.Background(), repo, "peer", "candidate"); err != nil {
		t.Fatalf("preflight: %v", err)
	}
	if after := mustGit(t, repo, "rev-parse", "HEAD"); after != headBefore {
		t.Fatalf("HEAD moved: %s -> %s", headBefore, after)
	}
	if after := mustGit(t, repo, "status", "--porcelain"); after != statusBefore {
		t.Fatalf("working tree changed: %q -> %q", statusBefore, after)
	}
	if after := mustGit(t, repo, "show-ref"); after != refsBefore {
		t.Fatalf("refs changed:\n%s\n---\n%s", refsBefore, after)
	}
}

func TestPreflightMergeRequiresBothCommits(t *testing.T) {
	requireGit(t)
	repo := newTestHostRepo(t, "a.txt", "one\n")
	if _, err := PreflightMerge(context.Background(), repo, "", "HEAD"); err == nil {
		t.Fatal("expected an error when a commit is missing")
	}
}

func TestPreflightMergeIntoHostDetectsConflictWithUncommittedHostEdit(t *testing.T) {
	requireGit(t)
	host := newTestHostRepo(t, "a.txt", "one\ntwo\nthree\n")
	base := mustGit(t, host, "rev-parse", "HEAD")
	commitOnBranch(t, host, "whx/candidate", base, "a.txt", "one\nCANDIDATE\nthree\n")
	mustGit(t, host, "checkout", "-q", base)
	mustGit(t, host, "checkout", "-q", "-B", "main", base)
	// The operator is mid-edit on the same region, uncommitted. Preflighting
	// against bare HEAD would call this clean; the real merge would not be.
	if err := os.WriteFile(filepath.Join(host, "a.txt"), []byte("one\nOPERATOR-WIP\nthree\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	headBefore := mustGit(t, host, "rev-parse", "HEAD")
	statusBefore := mustGit(t, host, "status", "--porcelain")

	conflict, err := PreflightMergeIntoHost(context.Background(), host, "whx/candidate")
	if err != nil {
		t.Fatalf("preflight into host: %v", err)
	}
	if conflict == nil {
		t.Fatal("expected the operator's uncommitted edit to be seen as a conflict")
	}
	if len(conflict.Paths) != 1 || conflict.Paths[0] != "a.txt" {
		t.Fatalf("expected a.txt, got %v", conflict.Paths)
	}
	if after := mustGit(t, host, "rev-parse", "HEAD"); after != headBefore {
		t.Fatalf("preflight moved HEAD: %s -> %s", headBefore, after)
	}
	if after := mustGit(t, host, "status", "--porcelain"); after != statusBefore {
		t.Fatalf("preflight changed the working tree: %q -> %q", statusBefore, after)
	}
}

func TestPreflightMergeIntoHostAllowsCleanMerge(t *testing.T) {
	requireGit(t)
	host := newTestHostRepo(t, "a.txt", "one\ntwo\nthree\n")
	base := mustGit(t, host, "rev-parse", "HEAD")
	commitOnBranch(t, host, "whx/candidate", base, "b.txt", "unrelated\n")
	mustGit(t, host, "checkout", "-q", "-B", "main", base)

	conflict, err := PreflightMergeIntoHost(context.Background(), host, "whx/candidate")
	if err != nil {
		t.Fatalf("preflight into host: %v", err)
	}
	if conflict != nil {
		t.Fatalf("expected a clean preflight, got %v", conflict.Paths)
	}
}

func TestManagedKnowledgeConflictIsLocallyPreservedDuringMerge(t *testing.T) {
	requireGit(t)
	host := newTestHostRepo(t, "source.txt", "base source\n")
	managed := filepath.Join(host, ".wharnex", "knowledge")
	if err := os.MkdirAll(managed, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(managed, "topic.md"), []byte("base knowledge\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	mustGit(t, host, "add", ".wharnex/knowledge/topic.md")
	mustGit(t, host, "-c", "user.name=T", "-c", "user.email=t@example.invalid", "commit", "-qm", "knowledge base")
	base := mustGit(t, host, "rev-parse", "HEAD")

	mustGit(t, host, "checkout", "-qb", "whx/candidate", base)
	if err := os.WriteFile(filepath.Join(managed, "topic.md"), []byte("candidate snapshot knowledge\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(host, "source.txt"), []byte("candidate source\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	mustGit(t, host, "add", ".wharnex/knowledge/topic.md", "source.txt")
	mustGit(t, host, "-c", "user.name=T", "-c", "user.email=t@example.invalid", "commit", "-qm", "candidate")

	mustGit(t, host, "checkout", "-q", "-B", "main", base)
	if err := os.WriteFile(filepath.Join(managed, "topic.md"), []byte("current host knowledge\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	mustGit(t, host, "add", ".wharnex/knowledge/topic.md")
	mustGit(t, host, "-c", "user.name=T", "-c", "user.email=t@example.invalid", "commit", "-qm", "host knowledge")

	conflict, err := PreflightMergeIntoHost(context.Background(), host, "whx/candidate")
	if err != nil {
		t.Fatalf("preflight: %v", err)
	}
	if conflict != nil {
		t.Fatalf("managed-only conflict must not be planner-routed: %v", conflict.Paths)
	}
	if _, err := MergeBranchOnHost(context.Background(), host, "whx/candidate"); err != nil {
		t.Fatalf("merge should preserve managed host state locally: %v", err)
	}
	knowledge, err := os.ReadFile(filepath.Join(managed, "topic.md"))
	if err != nil || string(knowledge) != "current host knowledge\n" {
		t.Fatalf("managed host state was overwritten: err=%v content=%q", err, knowledge)
	}
	source, err := os.ReadFile(filepath.Join(host, "source.txt"))
	if err != nil || string(source) != "candidate source\n" {
		t.Fatalf("verified candidate source was not merged: err=%v content=%q", err, source)
	}
}

func TestPreflightKeepsOrdinaryConflictWhenManagedStateAlsoConflicts(t *testing.T) {
	requireGit(t)
	host := newTestHostRepo(t, "source.txt", "base source\n")
	managed := filepath.Join(host, ".wharnex", "knowledge")
	if err := os.MkdirAll(managed, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(managed, "topic.md"), []byte("base knowledge\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	mustGit(t, host, "add", ".wharnex/knowledge/topic.md")
	mustGit(t, host, "-c", "user.name=T", "-c", "user.email=t@example.invalid", "commit", "-qm", "knowledge base")
	base := mustGit(t, host, "rev-parse", "HEAD")

	mustGit(t, host, "checkout", "-qb", "whx/candidate-mixed", base)
	if err := os.WriteFile(filepath.Join(managed, "topic.md"), []byte("candidate knowledge\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(host, "source.txt"), []byte("candidate source\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	mustGit(t, host, "add", ".wharnex/knowledge/topic.md", "source.txt")
	mustGit(t, host, "-c", "user.name=T", "-c", "user.email=t@example.invalid", "commit", "-qm", "candidate")

	mustGit(t, host, "checkout", "-q", "-B", "main", base)
	if err := os.WriteFile(filepath.Join(managed, "topic.md"), []byte("host knowledge\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(host, "source.txt"), []byte("host source\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	mustGit(t, host, "add", ".wharnex/knowledge/topic.md", "source.txt")
	mustGit(t, host, "-c", "user.name=T", "-c", "user.email=t@example.invalid", "commit", "-qm", "host")

	conflict, err := PreflightMergeIntoHost(context.Background(), host, "whx/candidate-mixed")
	if err != nil {
		t.Fatalf("preflight: %v", err)
	}
	if conflict == nil || len(conflict.Paths) != 1 || conflict.Paths[0] != "source.txt" {
		t.Fatalf("expected only planner-resolvable source conflict, got %#v", conflict)
	}
}

func TestMergeConflictOmitsManagedKnowledgeWhenOrdinaryPathAlsoConflicts(t *testing.T) {
	requireGit(t)
	host := newTestHostRepo(t, "source.txt", "base source\n")
	managed := filepath.Join(host, ".wharnex", "knowledge")
	if err := os.MkdirAll(managed, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(managed, "topic.md"), []byte("base knowledge\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	mustGit(t, host, "add", ".wharnex/knowledge/topic.md")
	mustGit(t, host, "-c", "user.name=T", "-c", "user.email=t@example.invalid", "commit", "-qm", "knowledge base")
	base := mustGit(t, host, "rev-parse", "HEAD")

	mustGit(t, host, "checkout", "-qb", "whx/candidate-real-mixed", base)
	if err := os.WriteFile(filepath.Join(managed, "topic.md"), []byte("candidate knowledge\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(host, "source.txt"), []byte("candidate source\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	mustGit(t, host, "add", ".wharnex/knowledge/topic.md", "source.txt")
	mustGit(t, host, "-c", "user.name=T", "-c", "user.email=t@example.invalid", "commit", "-qm", "candidate")

	mustGit(t, host, "checkout", "-q", "-B", "main", base)
	if err := os.WriteFile(filepath.Join(managed, "topic.md"), []byte("host knowledge\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(host, "source.txt"), []byte("host source\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	mustGit(t, host, "add", ".wharnex/knowledge/topic.md", "source.txt")
	mustGit(t, host, "-c", "user.name=T", "-c", "user.email=t@example.invalid", "commit", "-qm", "host")
	preMerge := mustGit(t, host, "rev-parse", "HEAD")

	_, err := MergeBranchOnHost(context.Background(), host, "whx/candidate-real-mixed")
	var conflict *MergeConflictError
	if !errors.As(err, &conflict) {
		t.Fatalf("expected merge conflict, got %v", err)
	}
	if len(conflict.Paths) != 1 || conflict.Paths[0] != "source.txt" {
		t.Fatalf("expected only ordinary conflict path, got %v", conflict.Paths)
	}
	if got := mustGit(t, host, "rev-parse", "HEAD"); got != preMerge {
		t.Fatalf("aborted merge moved HEAD: got %s want %s", got, preMerge)
	}
	if status := mustGit(t, host, "status", "--porcelain"); status != "" {
		t.Fatalf("aborted merge left host dirty: %q", status)
	}
}
