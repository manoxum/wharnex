package protocol

import (
	"errors"
	"fmt"
	"path/filepath"
	"strings"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/projectknowledge"
)

func Validate(plan domain.ExecutionPlan) error {
	if len(plan.Operations) > MaxOperations {
		return errors.New("too many operations")
	}
	if len(plan.Verification) > MaxVerificationCommands {
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
	if baseline := strings.TrimSpace(plan.BaseContextSHA256); baseline != "" {
		if len(baseline) != 64 {
			return errors.New("base_context_sha256 must be a 64-character lowercase SHA-256")
		}
		for _, value := range baseline {
			if (value < '0' || value > '9') && (value < 'a' || value > 'f') {
				return errors.New("base_context_sha256 must be lowercase hexadecimal")
			}
		}
	}
	if len(plan.ImpactFiles) > MaxImpactFiles {
		return fmt.Errorf("impact_files exceeds %d paths", MaxImpactFiles)
	}
	for i, path := range plan.ImpactFiles {
		if err := validateDeclaredPath(path); err != nil {
			return fmt.Errorf("impact_files %d: %w", i, err)
		}
	}
	if len(plan.ReadFiles) > MaxReadFiles {
		return fmt.Errorf("read_files exceeds %d paths", MaxReadFiles)
	}
	for i, path := range plan.ReadFiles {
		if err := validateDeclaredPath(path); err != nil {
			return fmt.Errorf("read_files %d: %w", i, err)
		}
	}
	if len(plan.BarrierFiles) > MaxBarrierFiles {
		return fmt.Errorf("barrier_files exceeds %d paths", MaxBarrierFiles)
	}
	for i, path := range plan.BarrierFiles {
		if err := validateDeclaredPath(path); err != nil {
			return fmt.Errorf("barrier_files %d: %w", i, err)
		}
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

func ValidatePatchPaths(patch string) error {
	if len(patch) > MaxPatchBytes {
		return fmt.Errorf("patch exceeds %d byte limit", MaxPatchBytes)
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

// IsWharnexManagedPath reports whether a path is Wharnex-owned project state
// that the planner may never patch directly.
//
// Project knowledge is materialized by Wharnex from the `harness.knowledge/v2`
// records at the commit boundary; `catalog.json` is metadata derived from those
// records. A planner patch against this subtree would fight the materializer.
//
// Exported because the same rule has to be consulted where a merge conflict is
// routed: a conflict on one of these paths must be reconciled by Wharnex rather
// than handed to a planner that the validator would then refuse. The two rules
// contradicted each other, which produced a request that could never succeed and
// retried forever.
func IsWharnexManagedPath(value string) bool {
	return projectknowledge.IsManagedPath(value)
}

// validatePathShape enforces the structural rules every path must satisfy,
// regardless of whether it is being written, read, or merely forecast:
// traversal, absoluteness, and diff quoting/escaping.
func validatePathShape(value string) error {
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
	return nil
}

// validatePatchPath is the mutation boundary: path shape plus the denial of
// paths a plan may never write.
func validatePatchPath(value string) error {
	if err := validatePathShape(value); err != nil {
		return err
	}
	path := strings.TrimSpace(value)
	if path == "/dev/null" {
		return nil
	}
	path = strings.TrimPrefix(strings.TrimPrefix(path, "a/"), "b/")
	clean := filepath.Clean(path)
	lower := strings.ToLower(filepath.ToSlash(clean))
	base := filepath.Base(lower)
	safeEnvTemplate := base == ".env.example" || base == ".env.sample" || base == ".env.template"
	blocked := lower == ".env" || (strings.HasPrefix(base, ".env.") && !safeEnvTemplate) || lower == ".npmrc" || lower == ".netrc" || lower == ".pypirc" || lower == ".git-credentials" || lower == "credentials.json" || strings.HasPrefix(lower, ".git/") || strings.HasPrefix(lower, ".harness/") || IsWharnexManagedPath(lower) || strings.HasPrefix(lower, ".ssh/") || strings.HasPrefix(lower, ".aws/") || strings.Contains(lower, "/secrets/")
	if blocked {
		return fmt.Errorf("sensitive patch path denied: %s", path)
	}
	return nil
}

// ValidateWorkflowPlan constrains an iterative investigation step to the
// Protected sandbox. Workflow steps may run project-local commands to gather
// evidence, but they never patch the project, request network access, or
// become host-apply candidates.
func ValidateWorkflowPlan(plan domain.ExecutionPlan) error {
	if err := Validate(plan); err != nil {
		return err
	}
	if plan.Status != "ready" {
		return errors.New("workflow plan must be ready")
	}
	if plan.Risk == "high" {
		return errors.New("workflow plan risk must be low or medium")
	}
	if plan.RequiresApproval {
		return errors.New("workflow plan cannot require host approval")
	}
	if len(plan.Operations) == 0 {
		return errors.New("workflow plan requires at least one command operation")
	}
	if len(plan.Operations) > 16 {
		return errors.New("workflow plan exceeds 16 command operations")
	}
	for i, op := range plan.Operations {
		if op.Type != "command" {
			return fmt.Errorf("workflow operation %d must be command", i)
		}
		if op.Command.Network {
			return fmt.Errorf("workflow operation %d cannot request network access", i)
		}
	}
	for i, command := range plan.Verification {
		if command.Network {
			return fmt.Errorf("workflow verification %d cannot request network access", i)
		}
	}
	return nil
}
