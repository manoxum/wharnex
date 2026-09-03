package sandbox

import (
	"context"
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
