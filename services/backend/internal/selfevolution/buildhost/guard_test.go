package buildhost_test

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	selfevolution "kernl.local/harness/backend/internal/selfevolution"
)

func TestManagerDetectsOnlyExactCanonicalRoot(t *testing.T) {
	root := fakeRoot(t)
	manager := selfevolution.New(root)
	if !manager.IsProject(root) {
		t.Fatal("expected exact root to be self-evolution")
	}
	if manager.IsProject(filepath.Join(root, "services", "backend")) {
		t.Fatal("subdirectory must not be treated as self-evolution root")
	}
	link := filepath.Join(t.TempDir(), "wharness-link")
	if err := os.Symlink(root, link); err != nil {
		t.Fatal(err)
	}
	if !manager.IsProject(link) {
		t.Fatal("canonical symlink to the same root should be detected")
	}
}

func TestBuildHostRejectsDependencyMetadataMutation(t *testing.T) {
	root := fakeRoot(t)
	mustWrite(t, filepath.Join(root, "hello.txt"), "before\n", 0o644)
	mustWrite(t, filepath.Join(root, "Makefile"), "build-stage:\n\t@mkdir -p services/frontend\n\t@printf 'unexpected\\n' > services/frontend/package-lock.json\n", 0o644)
	patch := "--- a/hello.txt\n+++ b/hello.txt\n@@ -1 +1 @@\n-before\n+after\n"
	manager := selfevolution.New(root)
	tx, err := manager.Prepare("ses-build-guard", "plan-build-guard", []string{patch})
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Release()
	if _, err := manager.BuildHost(context.Background(), tx, nil); err == nil || !strings.Contains(err.Error(), "mutated source dependency metadata") {
		t.Fatalf("expected build guard rejection, got %v", err)
	}
	if err := tx.Rollback(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "services", "frontend", "package-lock.json")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("rollback should remove build-created lockfile, got %v", err)
	}
}

func TestBuildHostClassifiesHostToolchainMismatchAsUnrepairable(t *testing.T) {
	root := fakeRoot(t)
	mustWrite(t, filepath.Join(root, "hello.txt"), "before\n", 0o644)
	// Reproduces the real failure observed in production: a pinned Electron
	// version whose postinstall requires a newer Node than the host has,
	// surfacing as ERR_REQUIRE_ESM. No patch to project source can fix this,
	// so BuildHost must mark it distinctly from an ordinary build failure.
	mustWrite(t, filepath.Join(root, "Makefile"), "build-stage:\n"+
		"\t@printf 'Error [ERR_REQUIRE_ESM]: require() of ES Module not supported\\n' >&2\n"+
		"\t@printf 'Error: Electron failed to install correctly.\\n' >&2\n"+
		"\t@exit 2\n", 0o644)
	patch := "--- a/hello.txt\n+++ b/hello.txt\n@@ -1 +1 @@\n-before\n+after\n"
	manager := selfevolution.New(root)
	tx, err := manager.Prepare("ses-toolchain-guard", "plan-toolchain-guard", []string{patch})
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Release()
	_, err = manager.BuildHost(context.Background(), tx, nil)
	if err == nil {
		t.Fatal("expected BuildHost to fail")
	}
	if !errors.Is(err, selfevolution.ErrHostBuildToolchainMismatch) {
		t.Fatalf("expected selfevolution.ErrHostBuildToolchainMismatch, got %v", err)
	}
}

func TestBuildHostClassifiesUnsupportedBusyBoxFlockAsLocalInfrastructure(t *testing.T) {
	root := fakeRoot(t)
	mustWrite(t, filepath.Join(root, "hello.txt"), "before\n", 0o644)
	mustWrite(t, filepath.Join(root, "Makefile"), "build-stage:\n"+
		"\t@printf 'flock: unrecognized option: w\\n' >&2\n"+
		"\t@exit 2\n", 0o644)
	patch := "--- a/hello.txt\n+++ b/hello.txt\n@@ -1 +1 @@\n-before\n+after\n"
	manager := selfevolution.New(root)
	tx, err := manager.Prepare("ses-busybox-flock", "plan-busybox-flock", []string{patch})
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Release()

	_, err = manager.BuildHost(context.Background(), tx, nil)
	if !errors.Is(err, selfevolution.ErrHostBuildToolchainMismatch) {
		t.Fatalf("unsupported host flock must remain local infrastructure, got %v", err)
	}
}
