package app

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/domain"
)

func TestProtectedNodeDependencyLockstep(t *testing.T) {
	t.Run("scripts only does not require lockfile", func(t *testing.T) {
		base, candidate := nodePackageFixture(t,
			`{"name":"demo","scripts":{"test":"old"},"dependencies":{"react":"1.0.0"}}`,
			`{"name":"demo","scripts":{"test":"new"},"dependencies":{"react":"1.0.0"}}`)
		plan := planTouchingNodeFiles("services/frontend/package.json")
		before, err := snapshotProtectedNodeDependencyState(base)
		if err != nil {
			t.Fatal(err)
		}
		if err := validateProtectedNodeDependencyLockstep(before, candidate, &plan); err != nil {
			t.Fatalf("scripts-only edit was rejected: %v", err)
		}
	})

	t.Run("dependency change requires retained lockfile", func(t *testing.T) {
		base, candidate := nodePackageFixture(t,
			`{"name":"demo","dependencies":{"react":"1.0.0"}}`,
			`{"name":"demo","dependencies":{"react":"2.0.0"}}`)
		plan := planTouchingNodeFiles("services/frontend/package.json")
		before, err := snapshotProtectedNodeDependencyState(base)
		if err != nil {
			t.Fatal(err)
		}
		err = validateProtectedNodeDependencyLockstep(before, candidate, &plan)
		if err == nil || !strings.Contains(err.Error(), "services/frontend/package.json") || !strings.Contains(err.Error(), "services/frontend/package-lock.json") {
			t.Fatalf("missing lockfile was not diagnosed focally: %v", err)
		}
	})

	t.Run("sandbox side effect does not count as retained patch", func(t *testing.T) {
		base, candidate := nodePackageFixture(t,
			`{"name":"demo","dependencies":{"react":"1.0.0"}}`,
			`{"name":"demo","dependencies":{"react":"2.0.0"}}`)
		lock := filepath.Join(candidate, "services/frontend/package-lock.json")
		if err := os.WriteFile(lock, []byte(`{"lockfileVersion":3,"packages":{"":{"dependencies":{"react":"2.0.0"}}}}`), 0o600); err != nil {
			t.Fatal(err)
		}
		plan := planTouchingNodeFiles("services/frontend/package.json")
		before, err := snapshotProtectedNodeDependencyState(base)
		if err != nil {
			t.Fatal(err)
		}
		if err := validateProtectedNodeDependencyLockstep(before, candidate, &plan); err == nil {
			t.Fatal("an unretained npm side effect incorrectly satisfied the lockstep gate")
		}
	})

	t.Run("manifest and lockfile retained together pass", func(t *testing.T) {
		base, candidate := nodePackageFixture(t,
			`{"name":"demo","dependencies":{"react":"1.0.0"}}`,
			`{"name":"demo","dependencies":{"react":"2.0.0"}}`)
		plan := planTouchingNodeFiles("services/frontend/package.json", "services/frontend/package-lock.json")
		before, err := snapshotProtectedNodeDependencyState(base)
		if err != nil {
			t.Fatal(err)
		}
		if err := validateProtectedNodeDependencyLockstep(before, candidate, &plan); err != nil {
			t.Fatalf("complete manifest/lockfile candidate was rejected: %v", err)
		}
	})
}

func nodePackageFixture(t *testing.T, baseManifest, candidateManifest string) (string, string) {
	t.Helper()
	base, candidate := t.TempDir(), t.TempDir()
	for root, manifest := range map[string]string{base: baseManifest, candidate: candidateManifest} {
		dir := filepath.Join(root, "services/frontend")
		if err := os.MkdirAll(dir, 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "package.json"), []byte(manifest), 0o600); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "package-lock.json"), []byte(`{"lockfileVersion":3}`), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	return base, candidate
}

func planTouchingNodeFiles(paths ...string) domain.ExecutionPlan {
	plan := domain.ExecutionPlan{}
	for _, path := range paths {
		plan.Operations = append(plan.Operations, domain.Operation{
			Type:  "apply_patch",
			Patch: "--- a/" + path + "\n+++ b/" + path + "\n@@ -1 +1 @@\n-old\n+new\n",
		})
	}
	return plan
}
