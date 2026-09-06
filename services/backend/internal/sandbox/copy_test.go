package sandbox

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/domain"
)

func TestCopyProjectExcludesSecrets(t *testing.T) {
	root := t.TempDir()
	_ = os.WriteFile(filepath.Join(root, "main.txt"), []byte("ok"), 0o600)
	_ = os.WriteFile(filepath.Join(root, ".env"), []byte("secret"), 0o600)
	ws, err := copyProject(root)
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(ws.Path)
	if _, err := os.Stat(filepath.Join(ws.Path, "main.txt")); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(ws.Path, ".env")); !os.IsNotExist(err) {
		t.Fatal(".env should not be copied")
	}
}

func TestCopyProjectCreatesTrackedGitBaseline(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is not installed")
	}
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "hello.txt"), []byte("before\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	ws, err := copyProject(root)
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(ws.Path)
	if _, err := os.Stat(filepath.Join(ws.Path, ".git")); err != nil {
		t.Fatalf("sandbox .git missing: %v", err)
	}
	if err := os.WriteFile(filepath.Join(ws.Path, "hello.txt"), []byte("after\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command("git", "-C", ws.Path, "diff", "--check")
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git diff --check should work in sandbox: %v: %s", err, output)
	}
	cmd = exec.Command("git", "-C", ws.Path, "diff", "--", "hello.txt")
	output, err := cmd.Output()
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(output), "-before") || !strings.Contains(string(output), "+after") {
		t.Fatalf("sandbox baseline did not track copied files: %s", output)
	}
}

func TestCopyProjectDoesNotTreatAncestorRepositoryAsSourceRepository(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is not installed")
	}
	outer := t.TempDir()
	if output, err := exec.Command("git", "-C", outer, "init", "-q").CombinedOutput(); err != nil {
		t.Fatalf("initialize ancestor repository: %v: %s", err, output)
	}
	root := filepath.Join(outer, ".harness", "bridge", "tmp", "wharness-task-base-test")
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "base.txt"), []byte("immutable base\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	ws, err := copyProject(root)
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(ws.Path)
	if data, err := os.ReadFile(filepath.Join(ws.Path, "base.txt")); err != nil || string(data) != "immutable base\n" {
		t.Fatalf("copied immutable base missing: data=%q err=%v", data, err)
	}
	if _, err := os.Stat(filepath.Join(ws.Path, ".git")); err != nil {
		t.Fatalf("copied base did not receive an isolated Git baseline: %v", err)
	}
}

func TestHydrateMissingProjectFilesPreservesHistoricalFilesAndAddsDependencies(t *testing.T) {
	source := t.TempDir()
	target := t.TempDir()
	if err := os.WriteFile(filepath.Join(source, "changed.go"), []byte("current\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, "dependency.go"), []byte("dependency\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, ".env"), []byte("secret\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(target, "changed.go"), []byte("historical\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	if err := HydrateMissingProjectFiles(target, source); err != nil {
		t.Fatal(err)
	}
	if data, err := os.ReadFile(filepath.Join(target, "changed.go")); err != nil || string(data) != "historical\n" {
		t.Fatalf("historical file was replaced: data=%q err=%v", data, err)
	}
	if data, err := os.ReadFile(filepath.Join(target, "dependency.go")); err != nil || string(data) != "dependency\n" {
		t.Fatalf("missing dependency was not hydrated: data=%q err=%v", data, err)
	}
	if _, err := os.Stat(filepath.Join(target, ".env")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("secret path was hydrated into request base: %v", err)
	}
}

func TestCopyProjectPreservesRepositoryHistoryWithoutSourceHooks(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is not installed")
	}
	root := t.TempDir()
	git := func(args ...string) {
		t.Helper()
		argv := append([]string{"-C", root}, args...)
		cmd := exec.Command("git", argv...)
		cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v: %s", args, err, output)
		}
	}
	git("init", "-q")
	if err := os.WriteFile(filepath.Join(root, "history.txt"), []byte("one\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	git("add", "history.txt")
	git("-c", "user.name=Tester", "-c", "user.email=test@example.invalid", "commit", "-qm", "first")
	if err := os.WriteFile(filepath.Join(root, "history.txt"), []byte("two\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	git("add", "history.txt")
	git("-c", "user.name=Tester", "-c", "user.email=test@example.invalid", "commit", "-qm", "second")
	if err := os.MkdirAll(filepath.Join(root, ".git", "hooks"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".git", "hooks", "pre-commit"), []byte("#!/bin/sh\nexit 77\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "history.txt"), []byte("working-copy\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	ws, err := copyProject(root)
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(ws.Path)
	count, err := exec.Command("git", "-C", ws.Path, "rev-list", "--count", "HEAD").Output()
	if err != nil || strings.TrimSpace(string(count)) != "2" {
		t.Fatalf("expected source history in sandbox, count=%q err=%v", count, err)
	}
	status, err := exec.Command("git", "-C", ws.Path, "status", "--short", "--", "history.txt").Output()
	if err != nil || !strings.Contains(string(status), "M history.txt") {
		t.Fatalf("expected dirty source worktree overlay, status=%q err=%v", status, err)
	}
	if _, err := os.Stat(filepath.Join(ws.Path, ".git", "hooks", "pre-commit")); !os.IsNotExist(err) {
		t.Fatalf("source hook must not be copied into Protected sandbox")
	}
}

func TestSafeSandboxRemoteURLRejectsCredentialsAndNonHTTPS(t *testing.T) {
	if got, ok := safeSandboxRemoteURL("https://github.com/example/project.git"); !ok || got == "" {
		t.Fatalf("expected plain HTTPS remote to be accepted")
	}
	for _, raw := range []string{"https://token@github.com/example/project.git", "git@github.com:example/project.git", "file:///tmp/repo", "/tmp/repo"} {
		if _, ok := safeSandboxRemoteURL(raw); ok {
			t.Fatalf("unsafe sandbox remote accepted: %s", raw)
		}
	}
}

func TestLocalRunnerApplyPatchFallsBackToRecount(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is not installed")
	}
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "hello.txt"), []byte("a\nb\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	runner := NewLocalRunner()
	workspace, err := runner.Prepare(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	defer runner.Cleanup(workspace)
	patch := "diff --git a/hello.txt b/hello.txt\n--- a/hello.txt\n+++ b/hello.txt\n@@ -1,99 +1,99 @@\n-a\n+A\n b\n"
	result, err := runner.ApplyPatch(context.Background(), workspace, patch)
	if err != nil {
		t.Fatalf("recount fallback failed: %v; stderr=%s", err, result.Stderr)
	}
	data, err := os.ReadFile(filepath.Join(workspace.Path, "hello.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "A\nb\n" {
		t.Fatalf("unexpected patched content: %q", data)
	}
}

func TestLocalRunnerApplyPatchReportsGitDiagnostic(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is not installed")
	}
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "hello.txt"), []byte("actual\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	runner := NewLocalRunner()
	workspace, err := runner.Prepare(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	defer runner.Cleanup(workspace)
	patch := "--- a/hello.txt\n+++ b/hello.txt\n@@ -1 +1 @@\n-missing\n+new\n"
	_, err = runner.ApplyPatch(context.Background(), workspace, patch)
	if err == nil || !strings.Contains(err.Error(), "patch does not apply cleanly") || !strings.Contains(err.Error(), "hello.txt") {
		t.Fatalf("expected useful git diagnostic, got %v", err)
	}
}

func TestPrepareCommandDependenciesCopiesNodeModulesLazily(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is not installed")
	}
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "package.json"), []byte(`{"scripts":{"build":"tsc --noEmit"}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	binDir := filepath.Join(root, "node_modules", ".bin")
	pkgDir := filepath.Join(root, "node_modules", "typescript", "bin")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(pkgDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(pkgDir, "tsc"), []byte("#!/usr/bin/env node\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("../typescript/bin/tsc", filepath.Join(binDir, "tsc")); err != nil {
		t.Fatal(err)
	}

	ws, err := copyProject(root)
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(ws.Path)
	if _, err := os.Stat(filepath.Join(ws.Path, "node_modules")); !os.IsNotExist(err) {
		t.Fatal("node_modules must stay out of the initial sandbox copy")
	}

	command := domain.CommandSpec{Argv: []string{"npm", "run", "build"}, Cwd: "."}
	if err := prepareCommandDependencies(ws, command); err != nil {
		t.Fatal(err)
	}
	copiedLink := filepath.Join(ws.Path, "node_modules", ".bin", "tsc")
	target, err := os.Readlink(copiedLink)
	if err != nil {
		t.Fatalf("expected copied .bin symlink: %v", err)
	}
	resolved := filepath.Clean(filepath.Join(filepath.Dir(copiedLink), target))
	data, err := os.ReadFile(resolved)
	if err != nil {
		t.Fatalf("copied dependency target is unusable: %v", err)
	}
	if !strings.Contains(string(data), "/usr/bin/env node") {
		t.Fatalf("unexpected copied dependency: %q", data)
	}
}

func TestPrepareCommandDependenciesExplainsMissingNodeModules(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is not installed")
	}
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "package.json"), []byte(`{"scripts":{"build":"tsc --noEmit"}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	ws, err := copyProject(root)
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(ws.Path)
	err = prepareCommandDependencies(ws, domain.CommandSpec{Argv: []string{"npm", "run", "build"}, Cwd: "."})
	if err == nil || !strings.Contains(err.Error(), "install dependencies on the host") {
		t.Fatalf("expected actionable dependency error, got %v", err)
	}
}

func TestCopyDependencyTreeRejectsSymlinkOutsideProject(t *testing.T) {
	root := t.TempDir()
	external := t.TempDir()
	modules := filepath.Join(root, "node_modules")
	if err := os.MkdirAll(modules, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(external, filepath.Join(modules, "linked-package")); err != nil {
		t.Fatal(err)
	}
	dest := t.TempDir()
	err := copyDependencyTree(modules, filepath.Join(dest, "node_modules"), root, dest)
	if err == nil || !strings.Contains(err.Error(), "dependency symlink escapes project") {
		t.Fatalf("expected external dependency symlink to be rejected, got %v", err)
	}
}

func TestLocalRunnerNpmRunUsesHydratedNodeModules(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is not installed")
	}
	if _, err := exec.LookPath("npm"); err != nil {
		t.Skip("npm is not installed")
	}
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "package.json"), []byte(`{"name":"sandbox-deps-test","version":"1.0.0","scripts":{"build":"tsc --noEmit"}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	binDir := filepath.Join(root, "node_modules", ".bin")
	pkgDir := filepath.Join(root, "node_modules", "typescript", "bin")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(pkgDir, 0o755); err != nil {
		t.Fatal(err)
	}
	fakeTSC := filepath.Join(pkgDir, "tsc")
	if err := os.WriteFile(fakeTSC, []byte("#!/bin/sh\necho hydrated-tsc\nexit 0\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("../typescript/bin/tsc", filepath.Join(binDir, "tsc")); err != nil {
		t.Fatal(err)
	}

	runner := NewLocalRunner()
	workspace, err := runner.Prepare(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	defer runner.Cleanup(workspace)
	result, err := runner.Run(context.Background(), workspace, domain.CommandSpec{
		Argv:              []string{"npm", "run", "build"},
		Cwd:               ".",
		TimeoutSeconds:    30,
		ExpectedExitCodes: []int{0},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !result.Success || !strings.Contains(result.Stdout, "hydrated-tsc") {
		t.Fatalf("npm build did not use hydrated dependencies: success=%v stdout=%q stderr=%q", result.Success, result.Stdout, result.Stderr)
	}
}

func TestGoDependencyPreparationFailsOfflineBeforeRunnerExecution(t *testing.T) {
	if _, err := exec.LookPath("go"); err != nil {
		t.Skip("go is not installed")
	}
	source := t.TempDir()
	target := t.TempDir()
	goMod := "module example.invalid/offline\n\ngo 1.23\n\nrequire example.invalid/definitely-missing v1.0.0\n"
	if err := os.WriteFile(filepath.Join(source, "go.mod"), []byte(goMod), 0o600); err != nil {
		t.Fatal(err)
	}
	// The missing module must actually be part of the build list — a go.mod
	// requirement with no importing source file can be silently skipped by
	// `go mod download` (no `all` pattern), which would make this test pass
	// for the wrong reason and stay green even if `all` were reintroduced.
	offlineSource := "package offline\n\nimport _ \"example.invalid/definitely-missing\"\n"
	if err := os.WriteFile(filepath.Join(source, "offline.go"), []byte(offlineSource), 0o600); err != nil {
		t.Fatal(err)
	}
	err := prepareCommandDependencies(Workspace{Path: target, SourcePath: source}, domain.CommandSpec{Argv: []string{"go", "test", "./..."}, Cwd: "."})
	if !errors.Is(err, ErrOfflineDependenciesUnavailable) {
		t.Fatalf("expected an offline dependency preflight error, got %v", err)
	}
	if strings.Contains(strings.ToLower(err.Error()), "network is unreachable") {
		t.Fatalf("dependency preflight attempted network access: %v", err)
	}
	if !strings.Contains(err.Error(), "example.invalid/definitely-missing") {
		t.Fatalf("offline preflight did not name the missing module: %v", err)
	}
}

func TestGoDependencyCommandDetectionIsNarrow(t *testing.T) {
	for _, argv := range [][]string{{"go", "test", "./..."}, {"go", "vet", "./..."}, {"go", "build", "./cmd/app"}} {
		if !requiresLocalGoDependencies(argv) {
			t.Fatalf("expected Go dependency hydration for %v", argv)
		}
	}
	for _, argv := range [][]string{{"gofmt", "-w", "."}, {"go", "fmt", "./..."}, {"npm", "test"}} {
		if requiresLocalGoDependencies(argv) {
			t.Fatalf("unexpected Go dependency hydration for %v", argv)
		}
	}
}

func TestNetworkGoModDownloadUnlocksFollowingOfflineVerification(t *testing.T) {
	source := t.TempDir()
	target := t.TempDir()
	goMod := "module example.invalid/network-cache\n\ngo 1.23\n\nrequire example.invalid/not-in-host-cache v1.0.0\n"
	if err := os.WriteFile(filepath.Join(source, "go.mod"), []byte(goMod), 0o600); err != nil {
		t.Fatal(err)
	}
	workspace := Workspace{Path: target, SourcePath: source}
	download := domain.CommandSpec{Argv: []string{"go", "mod", "download"}, Cwd: ".", Network: true}
	if err := markNetworkGoDependenciesReady(workspace, download); err != nil {
		t.Fatal(err)
	}
	if err := prepareCommandDependencies(workspace, domain.CommandSpec{Argv: []string{"go", "test", "./..."}, Cwd: "."}); err != nil {
		t.Fatalf("following offline verification ignored the hydrated sandbox cache: %v", err)
	}
}

func TestPreparedGoDependenciesSupportOfflineVerification(t *testing.T) {
	if _, err := exec.LookPath("go"); err != nil {
		t.Skip("go is not installed")
	}
	cacheBytes, err := exec.Command("go", "env", "GOMODCACHE").Output()
	if err != nil {
		t.Skip("Go module cache is unavailable")
	}
	const moduleDir = "github.com/skip2/go-qrcode@v0.0.0-20200617195104-da1b6568686e"
	if _, err := os.Stat(filepath.Join(strings.TrimSpace(string(cacheBytes)), moduleDir)); err != nil {
		t.Skip("fixture module is not present in the host cache")
	}
	source := t.TempDir()
	target := t.TempDir()
	goMod := "module offline.example/check\n\ngo 1.23\n\nrequire github.com/skip2/go-qrcode v0.0.0-20200617195104-da1b6568686e\n"
	goSum := "github.com/skip2/go-qrcode v0.0.0-20200617195104-da1b6568686e h1:MRM5ITcdelLK2j1vwZ3Je0FKVCfqOLp5zO6trqMLYs0=\n" +
		"github.com/skip2/go-qrcode v0.0.0-20200617195104-da1b6568686e/go.mod h1:XV66xRDqSt+GTGFMVlhk3ULuV0y9ZmzeVGR4mloJI3M=\n"
	testSource := "package check\nimport (\"testing\"; qrcode \"github.com/skip2/go-qrcode\")\nfunc TestCached(t *testing.T) { if _, err := qrcode.Encode(\"ok\", qrcode.Medium, 64); err != nil { t.Fatal(err) } }\n"
	for name, content := range map[string]string{"go.mod": goMod, "go.sum": goSum, "cache_test.go": testSource} {
		if err := os.WriteFile(filepath.Join(source, name), []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(target, name), []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	workspace := Workspace{Path: target, SourcePath: source}
	if err := prepareCommandDependencies(workspace, domain.CommandSpec{Argv: []string{"go", "test", "./..."}, Cwd: "."}); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command("go", "test", "./...")
	cmd.Dir = target
	cmd.Env = append(os.Environ(), "GOPROXY=off", "GOMODCACHE="+filepath.Join(target, ".kernl", "go-mod"))
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("offline verification failed after hydration: %v: %s", err, output)
	}
}

func TestGoModuleInventoryUsesBuildListScope(t *testing.T) {
	cmd := goModuleInventoryCommand(t.TempDir())
	for _, arg := range cmd.Args {
		if arg == "all" {
			t.Fatal("module inventory used the `all` pattern: it walks test dependencies of dependencies, which are absent from the host cache and rewrite the host go.sum")
		}
	}
	found := false
	for _, env := range cmd.Env {
		if env == "GOPROXY=off" {
			found = true
			break
		}
	}
	if !found {
		t.Fatal("module inventory may reach the network: GOPROXY=off is not set")
	}
}

func TestGoDependencyInventoryDoesNotMutateHostGoSum(t *testing.T) {
	if _, err := exec.LookPath("go"); err != nil {
		t.Skip("go is not installed")
	}
	cacheBytes, err := exec.Command("go", "env", "GOMODCACHE").Output()
	if err != nil {
		t.Skip("Go module cache is unavailable")
	}
	const moduleDir = "github.com/skip2/go-qrcode@v0.0.0-20200617195104-da1b6568686e"
	if _, err := os.Stat(filepath.Join(strings.TrimSpace(string(cacheBytes)), moduleDir)); err != nil {
		t.Skip("fixture module is not present in the host cache")
	}
	source := t.TempDir()
	target := t.TempDir()
	goMod := "module offline.example/gosum\n\ngo 1.23\n\nrequire github.com/skip2/go-qrcode v0.0.0-20200617195104-da1b6568686e\n"
	goSum := "github.com/skip2/go-qrcode v0.0.0-20200617195104-da1b6568686e h1:MRM5ITcdelLK2j1vwZ3Je0FKVCfqOLp5zO6trqMLYs0=\n" +
		"github.com/skip2/go-qrcode v0.0.0-20200617195104-da1b6568686e/go.mod h1:XV66xRDqSt+GTGFMVlhk3ULuV0y9ZmzeVGR4mloJI3M=\n"
	testSource := "package gosum\nimport (\"testing\"; qrcode \"github.com/skip2/go-qrcode\")\nfunc TestCached(t *testing.T) { if _, err := qrcode.Encode(\"ok\", qrcode.Medium, 64); err != nil { t.Fatal(err) } }\n"
	if err := os.WriteFile(filepath.Join(source, "go.mod"), []byte(goMod), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, "go.sum"), []byte(goSum), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, "cache_test.go"), []byte(testSource), 0o600); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(filepath.Join(source, "go.sum"))
	if err != nil {
		t.Fatal(err)
	}
	if err := prepareCommandDependencies(Workspace{Path: target, SourcePath: source}, domain.CommandSpec{Argv: []string{"go", "build", "./..."}, Cwd: "."}); err != nil {
		t.Fatal(err)
	}
	after, err := os.ReadFile(filepath.Join(source, "go.sum"))
	if err != nil {
		t.Fatal(err)
	}
	if string(before) != string(after) {
		t.Fatalf("sandbox preparation rewrote the host go.sum:\nbefore:\n%s\nafter:\n%s", before, after)
	}
}
