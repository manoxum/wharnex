package protocol

import (
	"errors"
	"fmt"
	"kernl.local/harness/backend/internal/domain"
	"path/filepath"
	"strings"
)

func ValidateVersionIncrement(increment domain.VersionIncrement) error {
	if !domain.ValidVersionComponent(increment.Component) {
		return fmt.Errorf("version_increment component must be major, medium, minor or patch, got %q", increment.Component)
	}
	if increment.Amount < 1 || increment.Amount > 1000 {
		return errors.New("version_increment amount must be between 1 and 1000")
	}
	return nil
}

func ValidateChangePlan(plan domain.ExecutionPlan) error {
	if err := Validate(plan); err != nil {
		return err
	}
	if plan.Debug != nil {
		return errors.New("change plan must not contain debug protocol")
	}
	if plan.Protocol == domain.ProtocolV2 {
		if strings.TrimSpace(plan.Document) == "" {
			return errors.New("change plan requires a non-empty execution-contract document")
		}
		// Nil distinguishes an omitted key from an explicit empty JSON array. The
		// operator must be told that there is no impact; silence is not disclosure.
		if plan.Dependencies == nil {
			return errors.New("change plan requires dependencies (use [] when none)")
		}
		if plan.SystemTools == nil {
			return errors.New("change plan requires system_tools (use [] when none)")
		}
		if plan.ImpactFiles == nil {
			return errors.New("change plan requires impact_files with every patched path (use [] only when there are no patches)")
		}
		declared := make(map[string]bool, len(plan.ImpactFiles))
		for _, path := range plan.ImpactFiles {
			declared[path] = true
		}
		for _, operation := range plan.Operations {
			if operation.Type != "apply_patch" {
				continue
			}
			for _, path := range patchDeclaredPaths(operation.Patch) {
				if !declared[path] {
					return fmt.Errorf("impact_files must include patched path %q", path)
				}
			}
		}
	}
	for i, operation := range plan.Operations {
		if operation.Type != "apply_patch" && operation.Type != "command" {
			return fmt.Errorf("change operation %d cannot use interactive type %q", i, operation.Type)
		}
	}
	if plan.VersionIncrement == nil {
		return errors.New("change plan requires version_increment")
	}
	return nil
}

func patchDeclaredPaths(patch string) []string {
	seen := make(map[string]bool)
	paths := make([]string, 0)
	add := func(value string, stripDiffPrefix bool) {
		value = strings.TrimSpace(value)
		if stripDiffPrefix {
			if fields := strings.Fields(value); len(fields) > 0 {
				value = fields[0]
			}
			value = strings.TrimPrefix(strings.TrimPrefix(value, "a/"), "b/")
		}
		if value != "" && value != "/dev/null" && !seen[value] {
			seen[value] = true
			paths = append(paths, value)
		}
	}
	for _, line := range strings.Split(patch, "\n") {
		switch {
		case strings.HasPrefix(line, "+++ "), strings.HasPrefix(line, "--- "):
			add(line[4:], true)
		case strings.HasPrefix(line, "rename from "):
			add(strings.TrimPrefix(line, "rename from "), false)
		case strings.HasPrefix(line, "rename to "):
			add(strings.TrimPrefix(line, "rename to "), false)
		case strings.HasPrefix(line, "copy from "):
			add(strings.TrimPrefix(line, "copy from "), false)
		case strings.HasPrefix(line, "copy to "):
			add(strings.TrimPrefix(line, "copy to "), false)
		case strings.HasPrefix(line, "diff --git "):
			for _, value := range strings.Fields(strings.TrimPrefix(line, "diff --git ")) {
				add(value, true)
			}
		}
	}
	return paths
}

func validateImpactPath(value string) error {
	path := strings.TrimSpace(value)
	if path == "" {
		return errors.New("path is empty")
	}
	if strings.ContainsRune(path, '\x00') {
		return errors.New("path contains NUL")
	}
	if filepath.IsAbs(path) {
		return errors.New("path must be relative")
	}
	clean := filepath.Clean(path)
	if clean == "." || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return errors.New("path escapes project root")
	}
	return nil
}

// validateDeclaredPath checks a path a plan merely *declares* — `impact_files`
// (a scheduling forecast) and `read_files` (what the planner consulted).
//
// Secret-like paths stay denied even as a declaration: a plan stating it read
// `.env` or `.ssh/` is itself the signal to refuse, not just the patch that
// would follow.
//
// Wharnex-managed project knowledge is the one carve-out, because it is not a
// secret and not something the planner is sneaking access to — Wharnex
// materializes it itself at the commit boundary, so a plan forecasting that it
// changes is simply accurate. Denying that forecast rejected whole verified
// bundles with `impact_files 0: sensitive patch path denied`. The mutation
// boundary is untouched: an actual patch against those paths is still refused,
// which is where a write is really decided.
func validateDeclaredPath(value string) error {
	if err := validateImpactPath(value); err != nil {
		return err
	}
	if IsWharnexManagedPath(value) {
		return validatePathShape(value)
	}
	return validatePatchPath(value)
}

func ValidateCommand(command domain.CommandSpec) error {
	if len(command.Argv) > MaxCommandArgs {
		return errors.New("too many command arguments")
	}
	if len(command.Argv) == 0 || strings.TrimSpace(command.Argv[0]) == "" {
		return errors.New("command argv is required")
	}
	if command.TimeoutSeconds < MinCommandTimeoutSeconds || command.TimeoutSeconds > MaxCommandTimeoutSeconds {
		return fmt.Errorf("command timeout out of range: timeout_seconds must be %d..%d, got %d", MinCommandTimeoutSeconds, MaxCommandTimeoutSeconds, command.TimeoutSeconds)
	}
	if len(command.ExpectedExitCodes) == 0 {
		return errors.New("expected_exit_codes is required")
	}
	cwd := command.Cwd
	if cwd == "" {
		cwd = "."
	}
	if filepath.IsAbs(cwd) {
		return errors.New("cwd must be relative")
	}
	clean := filepath.Clean(cwd)
	if clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return errors.New("cwd escapes project root")
	}
	for _, arg := range command.Argv {
		if len(arg) > 65536 {
			return errors.New("command argument too large")
		}
		if strings.ContainsRune(arg, '\x00') {
			return errors.New("command argument contains NUL")
		}
	}
	return nil
}
