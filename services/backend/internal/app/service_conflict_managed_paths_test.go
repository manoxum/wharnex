package app

import (
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/protocol"
)

// A conflict on Wharnex-managed project state used to be handed to a planner
// whose every possible bundle the patch validator then rejected, producing a
// request that could not succeed and retried forever.
func TestPartitionManagedConflictPathsSeparatesUnpatchableState(t *testing.T) {
	managed, resolvable := partitionManagedConflictPaths([]string{
		".wharnex/knowledge/catalog.json",
		"services/backend/internal/app/service.go",
		".wharnex/knowledge/effort-level-budgets.md",
	})

	if len(managed) != 2 {
		t.Fatalf("expected both knowledge paths to be managed, got %v", managed)
	}
	if len(resolvable) != 1 || resolvable[0] != "services/backend/internal/app/service.go" {
		t.Fatalf("expected only the ordinary source path to be planner-resolvable, got %v", resolvable)
	}
}

func TestPartitionManagedConflictPathsKeepsOrdinaryPaths(t *testing.T) {
	managed, resolvable := partitionManagedConflictPaths([]string{"README.md", "src/index.ts"})
	if len(managed) != 0 {
		t.Fatalf("expected no managed paths, got %v", managed)
	}
	if len(resolvable) != 2 {
		t.Fatalf("expected both paths to remain resolvable, got %v", resolvable)
	}
}

// The partition and the patch validator must agree: any path the validator
// refuses must be recognised as managed, or the contradiction returns.
func TestManagedPathsAreExactlyThoseTheValidatorRefuses(t *testing.T) {
	for _, path := range []string{
		".wharnex/knowledge",
		".wharnex/knowledge/catalog.json",
		".wharnex/knowledge/nested/deep.md",
		"a/.wharnex/knowledge/catalog.json",
		"b/.wharnex/knowledge/catalog.json",
	} {
		if !protocol.IsWharnexManagedPath(path) {
			t.Fatalf("expected %q to be recognised as Wharnex-managed", path)
		}
		if err := protocol.ValidatePatchPaths("--- a/" + path + "\n+++ b/" + path + "\n"); err == nil {
			t.Fatalf("expected the patch validator to refuse %q", path)
		}
	}

	for _, path := range []string{".wharnexrc", ".wharnex/config.json", "knowledge/catalog.json"} {
		if protocol.IsWharnexManagedPath(path) {
			t.Fatalf("expected %q not to be treated as managed knowledge state", path)
		}
	}
}

// Both integration paths — the Git-native merge and the legacy ChangeSet
// compare-and-swap — must refuse to hand Wharnex-managed state to a planner.
// Fixing only one left the other reporting "verified changes require focused
// conflict resolution" for a conflict no bundle could ever resolve.
func TestBothIntegrationPathsPartitionManagedState(t *testing.T) {
	source, err := os.ReadFile("service_changeset.go")
	if err != nil {
		t.Fatalf("read service_changeset.go: %v", err)
	}
	git, err := os.ReadFile("service_gitintegration.go")
	if err != nil {
		t.Fatalf("read service_gitintegration.go: %v", err)
	}
	for name, body := range map[string][]byte{"service_changeset.go": source, "service_gitintegration.go": git} {
		if !strings.Contains(string(body), "partitionManagedConflictPaths(paths)") {
			t.Fatalf("%s does not partition managed conflict paths", name)
		}
		if !strings.Contains(string(body), "failManagedOnlyConflict") {
			t.Fatalf("%s does not terminate a managed-only conflict locally", name)
		}
	}
}

// A managed-only conflict must be reported as its own terminal condition, not
// as a conflict that a focused resolution could still fix.
func TestManagedOnlyConflictIsADistinctTerminalError(t *testing.T) {
	if errors.Is(ErrManagedStateConflict, ErrIntegrationConflict) {
		t.Fatal("managed-state conflict must not be reported as a resolvable integration conflict")
	}
	wrapped := fmt.Errorf("%w: %s", ErrManagedStateConflict, ".wharnex/knowledge/catalog.json")
	if !errors.Is(wrapped, ErrManagedStateConflict) {
		t.Fatal("wrapped managed-state conflict must remain detectable")
	}
}
