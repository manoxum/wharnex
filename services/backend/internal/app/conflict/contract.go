package conflict

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"sort"
	"strings"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/protocol"
)

func AllPendingHaveChangeSets(pending []domain.PendingHostChange) bool {
	if len(pending) == 0 {
		return false
	}
	for index := range pending {
		if pending[index].ChangeSet == nil {
			return false
		}
	}
	return true
}

func BuildResolutionMessage(paths []string, localAttempts string) string {
	if strings.TrimSpace(localAttempts) != "" {
		localAttempts = "\n\n" + strings.TrimSpace(localAttempts) +
			"\nThese collisions already survived Wharnex's own line-granular and token-granular three-way merge, so a purely mechanical union of both sides is not the answer being asked for."
	}
	return fmt.Sprintf(`WHARNEX CONFLICT RESOLUTION PROTOCOL — harness.conflict/v1

This is a focused support turn for a real integration conflict. Preserve the original task intent while reconciling CURRENT with RESULT using BASE as the common ancestor.

Return one normal canonical Wharnex change bundle for this request. The plan base_context_sha256 must equal CURRENT REVISION. Its patches may modify ONLY these conflict paths:
- %s

Do not repeat unrelated project work, do not modify non-conflict paths, and do not return a workflow. Resolve every listed conflict in one deliberate bundle. The dedicated conflict surface is independent from the main planning conversation.%s

The complete BASE/CURRENT/RESULT capsule is attached at conflict/capsule.json inside the single request ZIP. Read that file before authoring the resolution. It is authoritative and deliberately is not duplicated in this prompt.`, strings.Join(paths, "\n- "), localAttempts)
}

func ValidateResolutionPlan(item domain.Session, plan *domain.ExecutionPlan, paths []string) error {
	if item.IntegrationConflict == nil || plan == nil || plan.RequestID != item.IntegrationConflict.RequestID {
		return nil
	}
	manual := make(map[string]bool, len(item.IntegrationConflict.ManualPaths))
	for _, path := range item.IntegrationConflict.ManualPaths {
		manual[path] = true
	}
	if len(paths) == 0 && len(manual) == 0 {
		return errors.New("conflict resolution requires a patch or a manual decision for every conflict path")
	}
	allowed := make(map[string]bool, len(item.IntegrationConflict.Paths))
	for _, path := range item.IntegrationConflict.Paths {
		allowed[path] = true
	}
	for _, path := range paths {
		if !allowed[path] {
			return fmt.Errorf("conflict resolution path is outside the capsule: %s", path)
		}
	}
	for path := range allowed {
		if manual[path] {
			continue
		}
		found := false
		for _, candidate := range paths {
			if candidate == path {
				found = true
				break
			}
		}
		if !found {
			return fmt.Errorf("conflict resolution omitted path: %s", path)
		}
	}
	return nil
}

func MutationFor(pending []domain.PendingHostChange, changeSetID, path string) (domain.FileMutation, bool) {
	for _, change := range pending {
		if change.ChangeSet == nil || change.ChangeSet.ID != changeSetID {
			continue
		}
		for _, mutation := range change.ChangeSet.Mutations {
			if mutation.Path == path {
				return mutation, true
			}
		}
	}
	return domain.FileMutation{}, false
}

func PlanIDFor(pending []domain.PendingHostChange, id string) string {
	for _, change := range pending {
		if change.ChangeSet != nil && change.ChangeSet.ID == id {
			return change.Plan.PlanID
		}
	}
	return ""
}

func NormalizeStrings(values []string) []string {
	seen := make(map[string]bool)
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" && !seen[value] {
			seen[value] = true
			result = append(result, value)
		}
	}
	sort.Strings(result)
	return result
}

func HashBytes(value []byte) string {
	if value == nil {
		return ""
	}
	sum := sha256.Sum256(value)
	return hex.EncodeToString(sum[:])
}

// partitionManagedConflictPaths splits conflicting paths into the ones Wharnex
// owns and the ones a planner is allowed to patch.
//
// The two sets must never be mixed in one focused-resolution request: a bundle
// that touches a managed path is rejected by the patch validator before any
// conflict-specific check runs, so including one makes the whole request
// unsatisfiable.
func PartitionManagedPaths(paths []string) (managed []string, resolvable []string) {
	for _, path := range paths {
		if protocol.IsWharnexManagedPath(path) {
			managed = append(managed, path)
			continue
		}
		resolvable = append(resolvable, path)
	}
	return managed, resolvable
}
