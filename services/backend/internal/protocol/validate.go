package protocol

import (
	"errors"
	"fmt"
	"path/filepath"
	"strings"

	"kernl.local/harness/backend/internal/domain"
)

func Validate(plan domain.ExecutionPlan) error {
	if len(plan.Operations) > 100 {
		return errors.New("too many operations")
	}
	if len(plan.Verification) > 50 {
		return errors.New("too many verification commands")
	}
	if plan.Protocol != domain.ProtocolV1 {
		return fmt.Errorf("unsupported protocol %q", plan.Protocol)
	}
	if plan.PlanID == "" || plan.RequestID == "" {
		return errors.New("plan_id and request_id are required")
	}
	if plan.Status != "ready" && plan.Status != "blocked" {
		return errors.New("status must be ready or blocked")
	}
	if plan.Risk != "low" && plan.Risk != "medium" && plan.Risk != "high" {
		return errors.New("invalid risk")
	}
	if plan.Status == "blocked" && (len(plan.Operations) != 0 || len(plan.Verification) != 0) {
		return errors.New("blocked plan cannot contain operations or verification")
	}
	for i, op := range plan.Operations {
		switch op.Type {
		case "apply_patch":
			if len(op.Command.Argv) != 0 {
				return fmt.Errorf("operation %d: apply_patch command placeholder must have empty argv", i)
			}
			if strings.TrimSpace(op.Patch) == "" {
				return fmt.Errorf("operation %d has empty patch", i)
			}
			if err := ValidatePatchPaths(op.Patch); err != nil {
				return fmt.Errorf("operation %d: %w", i, err)
			}
		case "command":
			if strings.TrimSpace(op.Patch) != "" {
				return fmt.Errorf("operation %d: command operation must have empty patch", i)
			}
			if err := ValidateCommand(op.Command); err != nil {
				return fmt.Errorf("operation %d: %w", i, err)
			}
		default:
			return fmt.Errorf("operation %d has unsupported type %q", i, op.Type)
		}
	}
	for i, command := range plan.Verification {
		if err := ValidateCommand(command); err != nil {
			return fmt.Errorf("verification %d: %w", i, err)
		}
	}
	return nil
}

func ValidateCommand(command domain.CommandSpec) error {
	if len(command.Argv) > 128 {
		return errors.New("too many command arguments")
	}
	if len(command.Argv) == 0 || strings.TrimSpace(command.Argv[0]) == "" {
		return errors.New("command argv is required")
	}
	if command.TimeoutSeconds < 1 || command.TimeoutSeconds > 1800 {
		return errors.New("command timeout out of range")
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

func ValidatePatchPaths(patch string) error {
	if len(patch) > 2*1024*1024 {
		return errors.New("patch exceeds 2 MiB limit")
	}
	for _, line := range strings.Split(patch, "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.Contains(trimmed, "mode 120000") || strings.Contains(trimmed, "mode 160000") {
			return errors.New("symlink/submodule patch modes are denied")
		}
		switch {
		case strings.HasPrefix(line, "+++ "), strings.HasPrefix(line, "--- "):
			path := strings.TrimSpace(line[4:])
			if fields := strings.Fields(path); len(fields) > 0 {
				path = fields[0]
			}
			if err := validatePatchPath(path); err != nil {
				return err
			}
		case strings.HasPrefix(line, "rename from "):
			if err := validatePatchPath(strings.TrimSpace(strings.TrimPrefix(line, "rename from "))); err != nil {
				return err
			}
		case strings.HasPrefix(line, "rename to "):
			if err := validatePatchPath(strings.TrimSpace(strings.TrimPrefix(line, "rename to "))); err != nil {
				return err
			}
		case strings.HasPrefix(line, "copy from "):
			if err := validatePatchPath(strings.TrimSpace(strings.TrimPrefix(line, "copy from "))); err != nil {
				return err
			}
		case strings.HasPrefix(line, "copy to "):
			if err := validatePatchPath(strings.TrimSpace(strings.TrimPrefix(line, "copy to "))); err != nil {
				return err
			}
		case strings.HasPrefix(line, "diff --git "):
			fields := strings.Fields(strings.TrimPrefix(line, "diff --git "))
			if len(fields) != 2 {
				return errors.New("malformed diff --git header")
			}
			for _, field := range fields {
				if err := validatePatchPath(field); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

func validatePatchPath(value string) error {
	path := strings.TrimSpace(value)
	if path == "/dev/null" {
		return nil
	}
	if path == "" {
		return errors.New("empty patch path")
	}
	if strings.HasPrefix(path, "\"") || strings.Contains(path, "\\") {
		return fmt.Errorf("quoted/escaped patch paths are denied: %s", path)
	}
	path = strings.TrimPrefix(path, "a/")
	path = strings.TrimPrefix(path, "b/")
	if filepath.IsAbs(path) {
		return fmt.Errorf("absolute patch path denied: %s", path)
	}
	clean := filepath.Clean(path)
	if clean == "." || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return fmt.Errorf("patch path escapes project: %s", path)
	}
	lower := strings.ToLower(filepath.ToSlash(clean))
	blocked := lower == ".env" || strings.HasPrefix(lower, ".env.") || lower == ".npmrc" || lower == ".netrc" || lower == ".pypirc" || lower == ".git-credentials" || lower == "credentials.json" || strings.HasPrefix(lower, ".git/") || strings.HasPrefix(lower, ".harness/") || strings.HasPrefix(lower, ".ssh/") || strings.HasPrefix(lower, ".aws/") || strings.Contains(lower, "/secrets/")
	if blocked {
		return fmt.Errorf("sensitive patch path denied: %s", path)
	}
	return nil
}
