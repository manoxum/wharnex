package sandbox

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCaptureRequestBaseDoesNotDisturbHostState(t *testing.T) {
	requireGit(t)
	host := newTestHostRepo(t, "a.txt", "committed\n")
	// An operator mid-edit: a dirty tracked file, an untracked file, and a
	// half-staged change none of which may be disturbed by a base capture.
	if err := os.WriteFile(filepath.Join(host, "a.txt"), []byte("dirty\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(host, "b.txt"), []byte("untracked\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(host, "staged.txt"), []byte("staged\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	mustGit(t, host, "add", "staged.txt")
	headBefore := mustGit(t, host, "rev-parse", "HEAD")
	statusBefore := mustGit(t, host, "status", "--porcelain")
	branchBefore := mustGit(t, host, "rev-parse", "--abbrev-ref", "HEAD")

	commit, err := CaptureRequestBase(context.Background(), host, "req_test")
	if err != nil {
		t.Fatalf("capture request base: %v", err)
	}
	if strings.TrimSpace(commit) == "" {
		t.Fatal("expected a base commit sha")
	}
	if after := mustGit(t, host, "rev-parse", "HEAD"); after != headBefore {
		t.Fatalf("HEAD moved: %s -> %s", headBefore, after)
	}
	if after := mustGit(t, host, "status", "--porcelain"); after != statusBefore {
		t.Fatalf("working tree/index changed:\n%s\n---\n%s", statusBefore, after)
	}
	if after := mustGit(t, host, "rev-parse", "--abbrev-ref", "HEAD"); after != branchBefore {
		t.Fatalf("branch changed: %s -> %s", branchBefore, after)
	}
	if branches := mustGit(t, host, "branch", "--list"); strings.Contains(branches, "wharnex") {
		t.Fatalf("base ref leaked into refs/heads: %s", branches)
	}
}

func TestCaptureRequestBaseRecordsWorkingTreeAndHonorsGitignore(t *testing.T) {
	requireGit(t)
	host := newTestHostRepo(t, "a.txt", "committed\n")
	if err := os.WriteFile(filepath.Join(host, ".gitignore"), []byte("secret.env\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	mustGit(t, host, "add", ".gitignore")
	mustGit(t, host, "-c", "user.name=T", "-c", "user.email=t@example.invalid", "commit", "-qm", "ignore")
	// Uncommitted edit plus untracked file: exactly what the model was shown.
	if err := os.WriteFile(filepath.Join(host, "a.txt"), []byte("what the model read\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(host, "new.txt"), []byte("also read\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(host, "secret.env"), []byte("TOKEN=nope\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	commit, err := CaptureRequestBase(context.Background(), host, "req_ignore")
	if err != nil {
		t.Fatalf("capture request base: %v", err)
	}
	content, exists, err := ReadFileAtRef(context.Background(), host, commit, "a.txt")
	if err != nil || !exists {
		t.Fatalf("read a.txt at base: %v exists=%v", err, exists)
	}
	if content != "what the model read\n" {
		t.Fatalf("base did not capture the uncommitted content: %q", content)
	}
	if _, exists, _ := ReadFileAtRef(context.Background(), host, commit, "new.txt"); !exists {
		t.Fatal("base did not capture the untracked file the model read")
	}
	if _, exists, _ := ReadFileAtRef(context.Background(), host, commit, "secret.env"); exists {
		t.Fatal("gitignored secret must never enter the request base tree")
	}
}

// This is the regression test for the production failure this mechanism
// exists to remove: a patch authored against one tree, executed after the
// host moved on, previously died as "patch does not apply cleanly" and burned
// an AI repair round. Rooted at its own base it applies cleanly and the
// divergence becomes an ordinary merge.
func TestBaseRootedPatchAppliesAfterHostAdvanced(t *testing.T) {
	requireGit(t)
	host := newTestHostRepo(t, "F.md", "line1\nline2\nline3\nline4\nline5\n")
	ctx := context.Background()
	base, err := CaptureRequestBase(ctx, host, "req_base")
	if err != nil {
		t.Fatalf("capture request base: %v", err)
	}
	// A peer chat integrates an unrelated edit to the same file first.
	if err := os.WriteFile(filepath.Join(host, "F.md"), []byte("line1\nPEER\nline3\nline4\nline5\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	mustGit(t, host, "add", "F.md")
	mustGit(t, host, "-c", "user.name=T", "-c", "user.email=t@example.invalid", "commit", "-qm", "peer")

	workspace := cloneSandbox(t, host)
	if err := FetchRefFromHost(ctx, workspace, host, RequestBaseRef("req_base")); err != nil {
		t.Fatalf("fetch request base: %v", err)
	}
	if err := CheckoutRequestBase(ctx, workspace, "whx/req_base", base); err != nil {
		t.Fatalf("checkout request base: %v", err)
	}
	// The patch the model authored against the base it was shown.
	patch := "--- a/F.md\n+++ b/F.md\n@@ -1,5 +1,6 @@\n line1\n line2\n line3\n+MODEL\n line4\n line5\n"
	patchPath := filepath.Join(workspace, "model.patch")
	if err := os.WriteFile(patchPath, []byte(patch), 0o600); err != nil {
		t.Fatal(err)
	}
	if output := mustGit(t, workspace, "apply", "model.patch"); output != "" {
		t.Fatalf("unexpected git apply output: %s", output)
	}
	if err := os.Remove(patchPath); err != nil {
		t.Fatal(err)
	}
	if _, err := CommitBaseRootedPatch(ctx, workspace, "feat: add MODEL line", []string{"F.md"}); err != nil {
		t.Fatalf("commit base-rooted patch: %v", err)
	}
	if err := PushBranchToHost(ctx, workspace, host, "whx/req_base"); err != nil {
		t.Fatalf("push integration branch: %v", err)
	}
	if _, err := MergeBranchOnHost(ctx, host, "whx/req_base"); err != nil {
		t.Fatalf("expected a clean merge with no model turn, got: %v", err)
	}
	merged, err := os.ReadFile(filepath.Join(host, "F.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(merged), "PEER") || !strings.Contains(string(merged), "MODEL") {
		t.Fatalf("merge lost one side:\n%s", merged)
	}
}

func TestDeleteRequestBaseRefReleasesAnchor(t *testing.T) {
	requireGit(t)
	host := newTestHostRepo(t, "a.txt", "x\n")
	ctx := context.Background()
	if _, err := CaptureRequestBase(ctx, host, "req_gone"); err != nil {
		t.Fatalf("capture request base: %v", err)
	}
	if err := DeleteRequestBaseRef(ctx, host, "req_gone"); err != nil {
		t.Fatalf("delete request base ref: %v", err)
	}
	if refs := mustGit(t, host, "show-ref"); strings.Contains(refs, "req_gone") {
		t.Fatalf("base ref still anchored: %s", refs)
	}
}

func TestCaptureRequestBaseExcludesManagedKnowledgeWorkingTreeDrift(t *testing.T) {
	requireGit(t)
	host := newTestHostRepo(t, "visible.txt", "committed\n")
	managed := filepath.Join(host, ".wharnex", "knowledge")
	if err := os.MkdirAll(managed, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(managed, "topic.md"), []byte("committed knowledge\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	mustGit(t, host, "add", ".wharnex/knowledge/topic.md")
	mustGit(t, host, "-c", "user.name=T", "-c", "user.email=t@example.invalid", "commit", "-qm", "knowledge")
	if err := os.WriteFile(filepath.Join(host, "visible.txt"), []byte("planner-visible drift\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(managed, "topic.md"), []byte("runtime knowledge drift\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	base, err := CaptureRequestBase(context.Background(), host, "req_managed")
	if err != nil {
		t.Fatalf("capture request base: %v", err)
	}
	visible, exists, err := ReadFileAtRef(context.Background(), host, base, "visible.txt")
	if err != nil || !exists || visible != "planner-visible drift\n" {
		t.Fatalf("planner-visible drift was not captured: exists=%v err=%v content=%q", exists, err, visible)
	}
	knowledge, exists, err := ReadFileAtRef(context.Background(), host, base, ".wharnex/knowledge/topic.md")
	if err != nil || !exists || knowledge != "committed knowledge\n" {
		t.Fatalf("managed runtime drift leaked into request base: exists=%v err=%v content=%q", exists, err, knowledge)
	}
	current, err := os.ReadFile(filepath.Join(managed, "topic.md"))
	if err != nil || string(current) != "runtime knowledge drift\n" {
		t.Fatalf("capture disturbed managed working tree: err=%v content=%q", err, current)
	}
}

func TestWithoutIntegratingUnitsFiltersOnlyExactGitlinkPaths(t *testing.T) {
	paths := []string{"README.md", "modules/api", "modules/api/config.yml", "./modules/web"}
	got := withoutIntegratingUnits(paths, []string{"modules/api", "modules/web"})
	want := []string{"README.md", "modules/api/config.yml"}
	if len(got) != len(want) {
		t.Fatalf("filtered conflicts = %#v, want %#v", got, want)
	}
	for index := range want {
		if got[index] != want[index] {
			t.Fatalf("filtered conflicts = %#v, want %#v", got, want)
		}
	}
}
