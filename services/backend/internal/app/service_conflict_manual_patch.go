package app

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/ids"
	"kernl.local/harness/backend/internal/protocol"
)

func manualConflictPlan(item domain.Session, paths []string, patch string) domain.ExecutionPlan {
	plan := domain.ExecutionPlan{
		Protocol: "harness.execution/v1", BaseContextSHA256: item.Context.Manifest.SHA256,
		ImpactFiles: append([]string(nil), paths...), PlanID: ids.New("plan"), RequestID: item.IntegrationConflict.RequestID,
		Status: "ready", Summary: "Apply the operator's manual conflict resolution.", CommitMessage: "fix(conflicts): apply manual resolution",
		Risk: "medium", RequiresApproval: false, Operations: []domain.Operation{}, Verification: conflictVerificationCommands(item),
	}
	if strings.TrimSpace(patch) != "" {
		plan.Operations = append(plan.Operations, domain.Operation{Type: "apply_patch", Patch: patch})
	}
	return plan
}

func conflictVerificationCommands(item domain.Session) []domain.CommandSpec {
	conflict := item.IntegrationConflict
	if conflict == nil || len(conflict.OriginalPlanIDs) == 0 {
		return nil
	}
	wanted := make(map[string]bool, len(conflict.OriginalPlanIDs))
	for _, planID := range conflict.OriginalPlanIDs {
		wanted[planID] = true
	}
	pending := pendingHostChanges(item)
	filtered := make([]domain.PendingHostChange, 0, len(pending))
	for _, change := range pending {
		if wanted[change.Plan.PlanID] {
			filtered = append(filtered, change)
		}
	}
	runs := dedupedIntegrationVerifications(filtered)
	commands := make([]domain.CommandSpec, 0, len(runs))
	for _, run := range runs {
		commands = append(commands, run.command)
	}
	return commands
}

func buildManualConflictPatch(ctx context.Context, workbench ConflictWorkbench, resolutions []ConflictManualResolution, requireAll bool) (string, []string, error) {
	allowed := make(map[string]ConflictWorkbenchFile, len(workbench.Files))
	for _, file := range workbench.Files {
		allowed[file.Path] = file
	}
	resolved := make(map[string]ConflictManualResolution, len(resolutions))
	for _, resolution := range resolutions {
		path := filepath.ToSlash(strings.TrimSpace(resolution.Path))
		if _, ok := allowed[path]; !ok {
			return "", nil, fmt.Errorf("manual resolution path is outside the conflict: %s", path)
		}
		resolved[path] = ConflictManualResolution{Path: path, Content: resolution.Content, Exists: resolution.Exists}
	}
	if requireAll && len(resolved) != len(allowed) {
		return "", nil, errors.New("manual resolution must resolve every conflict path")
	}
	paths := make([]string, 0, len(resolved))
	for path := range resolved {
		paths = append(paths, path)
	}
	sort.Strings(paths)
	if len(paths) == 0 {
		return "", paths, nil
	}
	tmp, err := os.MkdirTemp("", "wharnex-conflict-*")
	if err != nil {
		return "", nil, err
	}
	defer os.RemoveAll(tmp)
	git := func(args ...string) ([]byte, error) {
		cmd := exec.CommandContext(ctx, "git", append([]string{"-C", tmp}, args...)...)
		return cmd.CombinedOutput()
	}
	if out, runErr := git("init", "-q"); runErr != nil {
		return "", nil, fmt.Errorf("initialize conflict diff: %s", strings.TrimSpace(string(out)))
	}
	_, _ = git("config", "user.name", "Wharnex")
	_, _ = git("config", "user.email", "wharnex@localhost")
	for _, path := range paths {
		file := allowed[path]
		if file.CurrentExists {
			if writeErr := writeConflictTempFile(tmp, path, file.Current); writeErr != nil {
				return "", nil, writeErr
			}
		}
	}
	if out, runErr := git("add", "-A"); runErr != nil {
		return "", nil, fmt.Errorf("stage conflict base: %s", strings.TrimSpace(string(out)))
	}
	if out, runErr := git("commit", "-qm", "base", "--allow-empty"); runErr != nil {
		return "", nil, fmt.Errorf("commit conflict base: %s", strings.TrimSpace(string(out)))
	}
	newPaths := make([]string, 0)
	for _, path := range paths {
		resolution := resolved[path]
		full := filepath.Join(tmp, filepath.FromSlash(path))
		if !resolution.Exists {
			if removeErr := os.Remove(full); removeErr != nil && !errors.Is(removeErr, os.ErrNotExist) {
				return "", nil, removeErr
			}
			continue
		}
		if writeErr := writeConflictTempFile(tmp, path, resolution.Content); writeErr != nil {
			return "", nil, writeErr
		}
		if !allowed[path].CurrentExists {
			newPaths = append(newPaths, path)
		}
	}
	if len(newPaths) > 0 {
		args := append([]string{"add", "-N", "--"}, newPaths...)
		if out, runErr := git(args...); runErr != nil {
			return "", nil, fmt.Errorf("prepare new conflict files: %s", strings.TrimSpace(string(out)))
		}
	}
	args := []string{"diff", "--binary", "--no-ext-diff", "HEAD", "--"}
	args = append(args, paths...)
	out, runErr := git(args...)
	if runErr != nil {
		return "", nil, fmt.Errorf("generate manual conflict patch: %s", strings.TrimSpace(string(out)))
	}
	patch := string(out)
	if strings.TrimSpace(patch) != "" {
		if err := protocol.ValidatePatchPaths(patch); err != nil {
			return "", nil, fmt.Errorf("validate manual conflict patch: %w", err)
		}
	}
	return patch, paths, nil
}

func writeConflictTempFile(root, path, content string) error {
	clean := filepath.Clean(filepath.FromSlash(path))
	if clean == "." || filepath.IsAbs(clean) || strings.HasPrefix(clean, ".."+string(filepath.Separator)) || clean == ".." {
		return fmt.Errorf("unsafe conflict path: %s", path)
	}
	full := filepath.Join(root, clean)
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		return err
	}
	return os.WriteFile(full, []byte(content), 0o644)
}

func augmentConflictResolutionPlan(item domain.Session, plan *domain.ExecutionPlan) error {
	conflict := item.IntegrationConflict
	if conflict == nil || plan == nil || plan.RequestID != conflict.RequestID || len(conflict.ManualPaths) == 0 {
		return nil
	}
	manual := make(map[string]bool, len(conflict.ManualPaths))
	for _, path := range conflict.ManualPaths {
		manual[path] = true
	}
	for _, path := range actualPatchFiles(plan) {
		if manual[path] {
			return fmt.Errorf("GPT plan attempted to overwrite manually resolved conflict path: %s", path)
		}
	}
	if strings.TrimSpace(conflict.ManualPatch) != "" {
		plan.Operations = append(plan.Operations, domain.Operation{Type: "apply_patch", Patch: conflict.ManualPatch})
	}
	plan.ImpactFiles = normalizedStrings(append(plan.ImpactFiles, conflict.ManualPaths...))
	return nil
}

func buildHybridConflictResolutionMessage(capsule []byte, remaining, manual []string) string {
	return fmt.Sprintf(`WHARNEX HYBRID CONFLICT RESOLUTION — harness.conflict/v1

The operator already resolved these paths manually and they are LOCKED:
- %s

Resolve ONLY the remaining paths below. Do not patch, rewrite, or mention locked paths in plan operations; Wharnex will inject the operator's patch after validating your bundle.

Remaining conflict paths:
- %s

Return one canonical change bundle. Every remaining path must be resolved against CURRENT. Do not modify unrelated files and do not return a workflow.

CONFLICT CAPSULE:
%s`, strings.Join(manual, "\n- "), strings.Join(remaining, "\n- "), string(capsule))
}
