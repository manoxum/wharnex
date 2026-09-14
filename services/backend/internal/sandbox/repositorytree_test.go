package sandbox

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"kernl.local/harness/backend/internal/domain"
)

func TestRepositoryTreeVersionsSubmoduleAndRollsBackAtomically(t *testing.T) {
	requireGit(t)
	host := newHostRepoWithSubmodule(t, "services/admin")
	mustGit(t, filepath.Join(host, "services", "admin"), "switch", "-qc", "devup")
	workspace, err := copyProject(host)
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(workspace.Path)

	patch := "diff --git a/services/admin/lib.txt b/services/admin/lib.txt\n--- a/services/admin/lib.txt\n+++ b/services/admin/lib.txt\n@@ -1 +1 @@\n-v1\n+v2\n"
	result, err := NewLocalRunner().ApplyPatch(context.Background(), workspace, patch)
	if err != nil || !result.Success {
		t.Fatalf("apply nested patch: result=%+v err=%v", result, err)
	}
	branch := "whx/req-submodule-tree"
	rootCommit, integrations, err := CommitVerifiedRepositoryTree(
		context.Background(), workspace.Path, host, branch, "feat: update admin", []string{"services/admin/lib.txt"}, false,
	)
	if err != nil {
		t.Fatal(err)
	}
	if rootCommit == "" || len(integrations) != 1 || integrations[0].Path != "services/admin" {
		t.Fatalf("unexpected repository candidates: root=%q nested=%+v", rootCommit, integrations)
	}
	if integrations[0].TargetBranch == "" || integrations[0].BaseCommit == "" {
		t.Fatalf("submodule branch identity was not retained: %+v", integrations[0])
	}
	if err := ValidateRepositoryIntegrations(context.Background(), host, integrations); err != nil {
		t.Fatalf("verified nested candidate must be present locally: %v", err)
	}

	childBefore := mustGit(t, filepath.Join(host, "services", "admin"), "rev-parse", "HEAD")
	rootMerge, err := MergeRepositoryTreeOnHost(context.Background(), host, branch, integrations)
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(host, "services", "admin", "lib.txt"))
	if err != nil || string(data) != "v2\n" {
		t.Fatalf("nested content was not applied: %q err=%v", data, err)
	}
	if recorded := mustGit(t, host, "rev-parse", "HEAD:services/admin"); recorded != integrations[0].Commit {
		t.Fatalf("superproject recorded %s, want %s", recorded, integrations[0].Commit)
	}
	if childBranch := mustGit(t, filepath.Join(host, "services", "admin"), "branch", "--show-current"); childBranch != integrations[0].TargetBranch {
		t.Fatalf("submodule branch changed to %q, want %q", childBranch, integrations[0].TargetBranch)
	}
	if err := DeleteHostBranch(context.Background(), filepath.Join(host, "services", "admin"), branch); err != nil {
		t.Fatalf("remove temporary submodule branch: %v", err)
	}
	if childBranch := mustGit(t, filepath.Join(host, "services", "admin"), "branch", "--show-current"); childBranch != "devup" {
		t.Fatalf("temporary branch cleanup changed active branch to %q", childBranch)
	}

	if _, err := RevertRepositoryTreeMerge(context.Background(), host, rootMerge.PreMergeSHA, integrations); err != nil {
		t.Fatal(err)
	}
	if got := mustGit(t, filepath.Join(host, "services", "admin"), "rev-parse", "HEAD"); got != childBefore {
		t.Fatalf("nested rollback restored %s, want %s", got, childBefore)
	}
	if childBranch := mustGit(t, filepath.Join(host, "services", "admin"), "branch", "--show-current"); childBranch != integrations[0].TargetBranch {
		t.Fatalf("rollback detached submodule from %q", integrations[0].TargetBranch)
	}
	if recorded := mustGit(t, host, "rev-parse", "HEAD:services/admin"); recorded != childBefore {
		t.Fatalf("superproject rollback recorded %s, want %s", recorded, childBefore)
	}
	if status := mustGit(t, host, "status", "--porcelain"); status != "" {
		t.Fatalf("repository tree remained dirty after rollback: %q", status)
	}
	data, err = os.ReadFile(filepath.Join(host, "services", "admin", "lib.txt"))
	if err != nil || string(data) != "v1\n" {
		t.Fatalf("nested content rollback failed: %q err=%v", data, err)
	}
}

func TestRepositoryTreeApplyIsIdempotentAfterNestedCommitAlreadyMerged(t *testing.T) {
	requireGit(t)
	host := newHostRepoWithSubmodule(t, "services/admin")
	repository := filepath.Join(host, "services", "admin")
	originalBranch := mustGit(t, repository, "branch", "--show-current")
	workspace, err := copyProject(host)
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(workspace.Path)

	patch := "diff --git a/services/admin/lib.txt b/services/admin/lib.txt\n--- a/services/admin/lib.txt\n+++ b/services/admin/lib.txt\n@@ -1 +1 @@\n-v1\n+v2\n"
	result, err := NewLocalRunner().ApplyPatch(context.Background(), workspace, patch)
	if err != nil || !result.Success {
		t.Fatalf("apply nested patch: result=%+v err=%v", result, err)
	}
	branch := "whx/req-partially-applied"
	_, integrations, err := CommitVerifiedRepositoryTree(
		context.Background(), workspace.Path, host, branch, "fix: update admin", []string{"services/admin/lib.txt"}, false,
	)
	if err != nil {
		t.Fatal(err)
	}
	mustGit(t, repository, "-c", "user.name=Tester", "-c", "user.email=test@example.invalid", "merge", "--no-ff", "--no-edit", integrations[0].Branch)
	alreadyIntegrated := mustGit(t, repository, "rev-parse", "HEAD")
	// The retired unit engine did not persist checkout identity. Recovery
	// measures the already-advanced branch as the transaction's safe base.
	integrations[0].BaseCommit = alreadyIntegrated

	if err := ValidateRepositoryIntegrations(context.Background(), host, integrations); err != nil {
		t.Fatalf("validate partially applied candidate: %v", err)
	}
	merge, err := MergeRepositoryTreeOnHost(context.Background(), host, branch, integrations)
	if err != nil {
		t.Fatal(err)
	}
	if head := mustGit(t, repository, "rev-parse", "HEAD"); head != alreadyIntegrated {
		t.Fatalf("idempotent Apply rewound nested branch to %s, want %s", head, alreadyIntegrated)
	}
	if selected := mustGit(t, repository, "branch", "--show-current"); selected != originalBranch {
		t.Fatalf("idempotent Apply detached nested branch: %q", selected)
	}
	if recorded := mustGit(t, host, "rev-parse", "HEAD:services/admin"); recorded != alreadyIntegrated {
		t.Fatalf("superproject recorded %s, want already-integrated %s", recorded, alreadyIntegrated)
	}
	if _, err := RevertRepositoryTreeMerge(context.Background(), host, merge.PreMergeSHA, integrations); err != nil {
		t.Fatal(err)
	}
	if head := mustGit(t, repository, "rev-parse", "HEAD"); head != alreadyIntegrated {
		t.Fatalf("rollback rewound pre-existing nested integration to %s", head)
	}
}

func TestValidateRepositoryIntegrationsRefusesMissingCommit(t *testing.T) {
	requireGit(t)
	host := newHostRepoWithSubmodule(t, "services/admin")
	err := ValidateRepositoryIntegrations(context.Background(), host, []domain.RepositoryIntegration{{Path: "services/admin", Commit: "0123456789012345678901234567890123456789"}})
	if err == nil {
		t.Fatal("missing nested commit was accepted")
	}
}

func TestValidateRepositoryIntegrationsRefusesUnregisteredRepository(t *testing.T) {
	requireGit(t)
	host := newHostRepoWithSubmodule(t, "services/admin")
	unregistered := filepath.Join(host, "scratch")
	if err := os.MkdirAll(unregistered, 0o755); err != nil {
		t.Fatal(err)
	}
	mustGit(t, unregistered, "init", "-q")
	if err := os.WriteFile(filepath.Join(unregistered, "note.txt"), []byte("unregistered\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	mustGit(t, unregistered, "add", "note.txt")
	mustGit(t, unregistered, "-c", "user.name=Tester", "-c", "user.email=test@example.invalid", "commit", "-qm", "init")
	commit := mustGit(t, unregistered, "rev-parse", "HEAD")
	err := ValidateRepositoryIntegrations(context.Background(), host, []domain.RepositoryIntegration{{Path: "scratch", Commit: commit}})
	if err == nil {
		t.Fatal("unregistered nested repository was accepted")
	}
}

func TestValidateRepositoryIntegrationsRefusesChangedDetachedCheckout(t *testing.T) {
	requireGit(t)
	host := newHostRepoWithSubmodule(t, "services/admin")
	repository := filepath.Join(host, "services", "admin")
	base := mustGit(t, repository, "rev-parse", "HEAD")
	mustGit(t, repository, "switch", "-c", "candidate")
	if err := os.WriteFile(filepath.Join(repository, "lib.txt"), []byte("candidate change\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	mustGit(t, repository, "add", "lib.txt")
	mustGit(t, repository, "-c", "user.name=Tester", "-c", "user.email=test@example.invalid", "commit", "-qm", "candidate change")
	candidate := mustGit(t, repository, "rev-parse", "HEAD")
	mustGit(t, repository, "checkout", "--detach", base)
	if err := os.WriteFile(filepath.Join(repository, "lib.txt"), []byte("operator change\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	mustGit(t, repository, "add", "lib.txt")
	mustGit(t, repository, "-c", "user.name=Tester", "-c", "user.email=test@example.invalid", "commit", "-qm", "operator change")

	err := ValidateRepositoryIntegrations(context.Background(), host, []domain.RepositoryIntegration{{
		Path: "services/admin", Commit: candidate, BaseCommit: base,
	}})
	if err == nil {
		t.Fatal("a detached checkout that moved after candidate recovery was accepted")
	}
}

func TestValidateRepositoryIntegrationsAcceptsAlreadyIntegratedCommit(t *testing.T) {
	requireGit(t)
	host := newHostRepoWithSubmodule(t, "services/admin")
	repository := filepath.Join(host, "services", "admin")
	originalBranch := mustGit(t, repository, "branch", "--show-current")
	mustGit(t, repository, "switch", "-c", "candidate")
	if err := os.WriteFile(filepath.Join(repository, "lib.txt"), []byte("candidate change\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	mustGit(t, repository, "add", "lib.txt")
	mustGit(t, repository, "-c", "user.name=Tester", "-c", "user.email=test@example.invalid", "commit", "-qm", "candidate change")
	candidate := mustGit(t, repository, "rev-parse", "HEAD")
	mustGit(t, repository, "switch", originalBranch)
	mustGit(t, repository, "-c", "user.name=Tester", "-c", "user.email=test@example.invalid", "merge", "--no-ff", "--no-edit", "candidate")
	current := mustGit(t, repository, "rev-parse", "HEAD")

	err := ValidateRepositoryIntegrations(context.Background(), host, []domain.RepositoryIntegration{{
		Path: "services/admin", Commit: candidate, TargetBranch: originalBranch, BaseCommit: current,
	}})
	if err != nil {
		t.Fatalf("an already integrated candidate must be a safe idempotent Apply: %v", err)
	}
}

func TestValidateRepositoryIntegrationsRefusesDetachedCheckoutSwitchedToBranch(t *testing.T) {
	requireGit(t)
	host := newHostRepoWithSubmodule(t, "services/admin")
	repository := filepath.Join(host, "services", "admin")
	base := mustGit(t, repository, "rev-parse", "HEAD")
	mustGit(t, repository, "checkout", "--detach", base)
	mustGit(t, repository, "switch", "-c", "operator-work")

	err := ValidateRepositoryIntegrations(context.Background(), host, []domain.RepositoryIntegration{{
		Path: "services/admin", Commit: base, BaseCommit: base,
	}})
	if err == nil {
		t.Fatal("a candidate recovered for detached HEAD was accepted after a branch switch")
	}
}

func TestRepositoryTreeSupportsNestedSubmodules(t *testing.T) {
	requireGit(t)
	leaf := newTestHostRepo(t, "leaf.txt", "before\n")
	child := newTestHostRepo(t, "child.txt", "child\n")
	gitAllowFile(t, child, "submodule", "add", "-q", "--", leaf, "modules/leaf")
	mustGit(t, child, "-c", "user.name=Tester", "-c", "user.email=test@example.invalid", "commit", "-qm", "add leaf")
	root := newTestHostRepo(t, "root.txt", "root\n")
	gitAllowFile(t, root, "submodule", "add", "-q", "--", child, "modules/child")
	mustGit(t, root, "-c", "user.name=Tester", "-c", "user.email=test@example.invalid", "commit", "-qm", "add child")
	gitAllowFile(t, root, "submodule", "update", "--init", "--recursive")

	workspace, err := copyProject(root)
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(workspace.Path)
	patch := "diff --git a/modules/child/modules/leaf/leaf.txt b/modules/child/modules/leaf/leaf.txt\n--- a/modules/child/modules/leaf/leaf.txt\n+++ b/modules/child/modules/leaf/leaf.txt\n@@ -1 +1 @@\n-before\n+after\n"
	result, err := NewLocalRunner().ApplyPatch(context.Background(), workspace, patch)
	if err != nil || !result.Success {
		t.Fatalf("apply nested patch: result=%+v err=%v", result, err)
	}
	branch := "whx/req-recursive-submodule"
	_, integrations, err := CommitVerifiedRepositoryTree(context.Background(), workspace.Path, root, branch, "feat: update nested leaf", []string{"modules/child/modules/leaf/leaf.txt"}, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(integrations) != 2 || integrations[0].Path != "modules/child" || integrations[1].Path != "modules/child/modules/leaf" {
		t.Fatalf("nested repository candidates = %+v", integrations)
	}
	merge, err := MergeRepositoryTreeOnHost(context.Background(), root, branch, integrations)
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(root, "modules", "child", "modules", "leaf", "leaf.txt"))
	if err != nil || string(data) != "after\n" {
		t.Fatalf("recursive checkout was not synchronized: %q err=%v", data, err)
	}
	if _, err := RevertRepositoryTreeMerge(context.Background(), root, merge.PreMergeSHA, integrations); err != nil {
		t.Fatal(err)
	}
	data, err = os.ReadFile(filepath.Join(root, "modules", "child", "modules", "leaf", "leaf.txt"))
	if err != nil || string(data) != "before\n" {
		t.Fatalf("recursive rollback was not synchronized: %q err=%v", data, err)
	}
}
