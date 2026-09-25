package protocol

import (
	"errors"
	"fmt"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"kernl.local/harness/backend/internal/crossproject"
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
	if plan.Protocol != domain.ProtocolV1 && plan.Protocol != domain.ProtocolV2 {
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
	if err := validatePlanPresentation(plan); err != nil {
		return err
	}
	if plan.VersionIncrement != nil {
		if err := ValidateVersionIncrement(*plan.VersionIncrement); err != nil {
			return err
		}
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
	if err := validateOperations(plan.Operations); err != nil {
		return err
	}
	for i, command := range plan.Verification {
		if err := ValidateCommand(command); err != nil {
			return fmt.Errorf("verification %d: %w", i, err)
		}
	}
	return validateCrossProjectUnits(plan.CrossProject)
}

func validatePlanPresentation(plan domain.ExecutionPlan) error {
	if len(plan.Document) > 256<<10 {
		return errors.New("document exceeds 256 KiB limit")
	}
	if len(plan.Dependencies) > 128 {
		return errors.New("dependencies exceeds 128 entries")
	}
	for i, dependency := range plan.Dependencies {
		if strings.TrimSpace(dependency.Scope) == "" || strings.TrimSpace(dependency.Manager) == "" || strings.TrimSpace(dependency.Name) == "" || strings.TrimSpace(dependency.Reason) == "" {
			return fmt.Errorf("dependencies %d requires scope, manager, name and reason", i)
		}
		switch dependency.Action {
		case "install", "update", "remove", "use":
		default:
			return fmt.Errorf("dependencies %d has invalid action %q", i, dependency.Action)
		}
		if err := validateAcquisitionStrategies(dependency.Acquisition, false); err != nil {
			return fmt.Errorf("dependencies %d acquisition: %w", i, err)
		}
	}
	if len(plan.SystemTools) > 64 {
		return errors.New("system_tools exceeds 64 entries")
	}
	for i, tool := range plan.SystemTools {
		if tool.Target != "sandbox" && tool.Target != "host" {
			return fmt.Errorf("system_tools %d target must be sandbox or host", i)
		}
		if strings.TrimSpace(tool.Name) == "" || strings.TrimSpace(tool.Reason) == "" {
			return fmt.Errorf("system_tools %d requires name and reason", i)
		}
		switch tool.Action {
		case "install", "update", "configure", "use":
		default:
			return fmt.Errorf("system_tools %d has invalid action %q", i, tool.Action)
		}
		switch tool.Lifetime {
		case "", domain.ToolLifetimeTemporary, domain.ToolLifetimePersistent:
		default:
			return fmt.Errorf("system_tools %d has invalid lifetime %q", i, tool.Lifetime)
		}
		if err := validateAcquisitionStrategies(tool.Acquisition, tool.Target == "host" && tool.Action != "use"); err != nil {
			return fmt.Errorf("system_tools %d acquisition: %w", i, err)
		}
	}
	if approved := plan.ApprovedChatPlan; approved != nil {
		if approved.Protocol != "harness.chat-plan/v1" || strings.TrimSpace(approved.RequestID) == "" || len(approved.SHA256) != 64 || strings.TrimSpace(approved.Document) == "" {
			return errors.New("approved_chat_plan requires protocol, request_id, sha256 and document")
		}
		if len(approved.Document) > 256<<10 {
			return errors.New("approved_chat_plan document exceeds 256 KiB limit")
		}
		for _, value := range approved.SHA256 {
			if (value < '0' || value > '9') && (value < 'a' || value > 'f') {
				return errors.New("approved_chat_plan sha256 must be lowercase hexadecimal")
			}
		}
	}
	return nil
}

// validateCrossProjectUnits checks the structure of work aimed at other
// projects. It is deliberately the same validation the primary plan gets: a
// change to another project is a whole change, and there is no reason it should
// be held to a weaker standard because it arrived inside somebody else's plan.
//
// What it does not do is decide authority. Whether a named project may be
// written at all is answered from the request's own grant at ingestion, with
// the session in hand; this function only sees the plan.
func validateAcquisitionStrategies(strategies []domain.PlanAcquisitionStrategy, hostMutation bool) error {
	if len(strategies) > 8 {
		return errors.New("exceeds 8 strategies")
	}
	for i, strategy := range strategies {
		if strings.TrimSpace(strategy.Reason) == "" {
			return fmt.Errorf("strategy %d requires reason", i)
		}
		switch strategy.Method {
		case "preinstalled", "project_cache", "lockfile_install", "corepack", "package_manager", "runner_image", "operator":
		default:
			return fmt.Errorf("strategy %d has invalid method %q", i, strategy.Method)
		}
		if hostMutation && strategy.Automatic {
			return fmt.Errorf("strategy %d cannot be automatic for host install/update/configure", i)
		}
	}
	return nil
}

func validateCrossProjectUnits(units []domain.CrossProjectUnit) error {
	if len(units) > MaxCrossProjectUnits {
		return fmt.Errorf("cross_project exceeds %d projects", MaxCrossProjectUnits)
	}
	for i, unit := range units {
		if !crossproject.ValidName(unit.Project) {
			return fmt.Errorf("cross_project %d: project must be a reference name from the request's @ref: grant, got %q", i, unit.Project)
		}
		// A unit with nothing to do is a declaration of authority over another
		// project with no change behind it. It is refused rather than ignored,
		// because silently dropping it would leave the response claiming a
		// change that never happened.
		if len(unit.Operations) == 0 {
			return fmt.Errorf("cross_project %d: project %q declares no operations", i, unit.Project)
		}
		if len(unit.Operations) > MaxOperations {
			return fmt.Errorf("cross_project %d: too many operations", i)
		}
		if len(unit.Verification) > MaxVerificationCommands {
			return fmt.Errorf("cross_project %d: too many verification commands", i)
		}
		// The message becomes that project's own permanent Git history, under
		// the same contract as any other commit Wharnex makes there.
		if err := ValidateCommitMessage(unit.CommitMessage); err != nil {
			return fmt.Errorf("cross_project %d: %w", i, err)
		}
		if err := validateOperations(unit.Operations); err != nil {
			return fmt.Errorf("cross_project %d: %w", i, err)
		}
		for j, command := range unit.Verification {
			if err := ValidateCommand(command); err != nil {
				return fmt.Errorf("cross_project %d: verification %d: %w", i, j, err)
			}
		}
	}
	return nil
}

func validateOperations(operations []domain.Operation) error {
	for i, op := range operations {
		switch op.Type {
		case "apply_patch":
			if len(op.Command.Argv) != 0 {
				return fmt.Errorf("operation %d: apply_patch command placeholder must have empty argv", i)
			}
			if strings.TrimSpace(op.Patch) == "" {
				return fmt.Errorf("operation %d has empty patch", i)
			}
			if err := ValidatePatch(op.Patch); err != nil {
				return fmt.Errorf("operation %d: %w", i, err)
			}
		case "command":
			if strings.TrimSpace(op.Patch) != "" {
				return fmt.Errorf("operation %d: command operation must have empty patch", i)
			}
			if err := ValidateCommand(op.Command); err != nil {
				return fmt.Errorf("operation %d: %w", i, err)
			}
		case "shell":
			if err := validateInteractiveShell(op.Shell); err != nil {
				return fmt.Errorf("operation %d: %w", i, err)
			}
		case "sql":
			if err := validateInteractiveSQL(op.SQL); err != nil {
				return fmt.Errorf("operation %d: %w", i, err)
			}
		case "logs":
			if err := validateInteractiveLogs(op.Logs); err != nil {
				return fmt.Errorf("operation %d: %w", i, err)
			}
		case "filesystem":
			if err := validateInteractiveFilesystem(op.Filesystem); err != nil {
				return fmt.Errorf("operation %d: %w", i, err)
			}
		case "process":
			if err := validateInteractiveProcess(op.Process); err != nil {
				return fmt.Errorf("operation %d: %w", i, err)
			}
		case "network":
			if err := validateInteractiveNetwork(op.Network); err != nil {
				return fmt.Errorf("operation %d: %w", i, err)
			}
		case "container":
			if err := validateInteractiveContainer(op.Container); err != nil {
				return fmt.Errorf("operation %d: %w", i, err)
			}
		case "service":
			if err := validateInteractiveService(op.Service); err != nil {
				return fmt.Errorf("operation %d: %w", i, err)
			}
		default:
			return fmt.Errorf("operation %d has unsupported type %q", i, op.Type)
		}
	}
	return nil
}

func validateInteractiveShell(spec *domain.InteractiveShellSpec) error {
	if spec == nil || strings.TrimSpace(spec.Script) == "" {
		return errors.New("shell operation requires script")
	}
	if len(spec.Script) > 64<<10 {
		return errors.New("shell script exceeds 64 KiB limit")
	}
	if spec.Shell != "bash" {
		return errors.New("shell operation currently supports bash only")
	}
	if spec.TimeoutSeconds < MinCommandTimeoutSeconds || spec.TimeoutSeconds > MaxCommandTimeoutSeconds {
		return errors.New("shell timeout_seconds is outside the command timeout budget")
	}
	for _, name := range spec.EnvAllowlist {
		if !validInteractiveEnvName(strings.TrimSpace(name)) {
			return errors.New("shell env_allowlist contains an invalid variable name")
		}
	}
	return nil
}

func validInteractiveEnvName(name string) bool {
	if name == "" {
		return false
	}
	for i := 0; i < len(name); i++ {
		c := name[i]
		if (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c == '_' || (i > 0 && c >= '0' && c <= '9') {
			continue
		}
		return false
	}
	return true
}

func validateInteractiveSQL(spec *domain.InteractiveSQLSpec) error {
	if spec == nil || strings.TrimSpace(spec.ConnectionID) == "" || strings.TrimSpace(spec.Statement) == "" {
		return errors.New("sql operation requires connection_id and statement")
	}
	if len(spec.Statement) > 64<<10 {
		return errors.New("sql statement exceeds 64 KiB limit")
	}
	if spec.Mode != "read_only" && spec.Mode != "write" {
		return errors.New("sql mode must be read_only or write")
	}
	if spec.TimeoutSeconds < 1 || spec.TimeoutSeconds > 300 {
		return errors.New("sql timeout_seconds must be 1..300")
	}
	if spec.MaxRows < 1 || spec.MaxRows > 5000 {
		return errors.New("sql max_rows must be 1..5000")
	}
	return nil
}

func validateInteractiveLogs(spec *domain.InteractiveLogsSpec) error {
	if spec == nil || strings.TrimSpace(spec.Source) == "" {
		return errors.New("logs operation requires source")
	}
	if spec.Limit < 1 || spec.Limit > 5000 {
		return errors.New("logs limit must be 1..5000")
	}
	return nil
}

func validateInteractiveFilesystem(spec *domain.InteractiveFilesystemSpec) error {
	if spec == nil || strings.TrimSpace(spec.Path) == "" {
		return errors.New("filesystem operation requires path")
	}
	switch spec.Action {
	case "list", "stat", "read", "write", "remove", "rename":
	default:
		return fmt.Errorf("unsupported filesystem action %q", spec.Action)
	}
	if spec.MaxBytes < 0 || spec.MaxBytes > 4<<20 {
		return errors.New("filesystem max_bytes exceeds 4 MiB limit")
	}
	return nil
}

func validateInteractiveProcess(spec *domain.InteractiveProcessSpec) error {
	if spec == nil {
		return errors.New("process operation is required")
	}
	switch spec.Action {
	case "list":
	case "signal":
		if spec.PID <= 1 || strings.TrimSpace(spec.Signal) == "" {
			return errors.New("process signal requires pid > 1 and signal")
		}
	default:
		return fmt.Errorf("unsupported process action %q", spec.Action)
	}
	return nil
}

func validateInteractiveNetwork(spec *domain.InteractiveNetworkSpec) error {
	if spec == nil || strings.TrimSpace(spec.Address) == "" || spec.Action != "connect" {
		return errors.New("network operation requires action=connect and address")
	}
	if spec.TimeoutSeconds < 1 || spec.TimeoutSeconds > 60 {
		return errors.New("network timeout_seconds must be 1..60")
	}
	return nil
}

func validateInteractiveContainer(spec *domain.InteractiveContainerSpec) error {
	if spec == nil || strings.TrimSpace(spec.Name) == "" {
		return errors.New("container operation requires name")
	}
	switch spec.Action {
	case "inspect", "logs", "restart", "exec":
	default:
		return fmt.Errorf("unsupported container action %q", spec.Action)
	}
	if spec.Action == "exec" && len(spec.Argv) == 0 {
		return errors.New("container exec requires argv")
	}
	return nil
}

func validateInteractiveService(spec *domain.InteractiveServiceSpec) error {
	if spec == nil || strings.TrimSpace(spec.Name) == "" {
		return errors.New("service operation requires name")
	}
	if spec.Action != "status" && spec.Action != "restart" {
		return fmt.Errorf("unsupported service action %q", spec.Action)
	}
	return nil
}

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

var (
	unifiedDiffHunkHeaderPattern = regexp.MustCompile(`^@@ -([0-9]+)(?:,([0-9]+))? \+([0-9]+)(?:,([0-9]+))? @@(?: .*)?$`)
	diffGitHeaderPrefix          = "diff " + "--git"
	markdownFenceMarker          = strings.Repeat("`", 3)
)

// ValidatePatch performs the structural preflight required for every textual
// apply_patch operation before Policy or a sandbox sees the bytes. Path safety
// remains a separate concern but both checks intentionally fail closed here.
func ValidatePatch(patch string) error {
	if err := ValidatePatchPaths(patch); err != nil {
		return err
	}
	return validateUnifiedDiffStructure(patch)
}

func validateUnifiedDiffStructure(patch string) error {
	if strings.Contains(patch, markdownFenceMarker) {
		return errors.New("patch must be raw unified diff without Markdown fences")
	}
	lines := strings.Split(strings.ReplaceAll(patch, "\r\n", "\n"), "\n")
	sawStructure := false
	sawOldHeader := false
	sawNewHeader := false
	for index := 0; index < len(lines); index++ {
		line := strings.TrimSuffix(lines[index], "\r")
		if strings.Contains(line, diffGitHeaderPrefix) && !strings.HasPrefix(line, diffGitHeaderPrefix+" ") {
			return fmt.Errorf("line %d: malformed Git diff header", index+1)
		}
		switch {
		case strings.HasPrefix(line, diffGitHeaderPrefix+" "):
			if _, _, err := canonicalDiffGitPaths(line); err != nil {
				return fmt.Errorf("line %d: %w", index+1, err)
			}
			sawStructure = true
			sawOldHeader = false
			sawNewHeader = false
		case strings.HasPrefix(line, "--- "):
			sawStructure = true
			sawOldHeader = true
			sawNewHeader = false
		case strings.HasPrefix(line, "+++ "):
			if !sawOldHeader {
				return fmt.Errorf("line %d: +++ header requires a preceding --- header", index+1)
			}
			sawNewHeader = true
		case strings.HasPrefix(line, "@@"):
			if !sawNewHeader {
				return fmt.Errorf("line %d: hunk header requires a preceding ---/+++ pair", index+1)
			}
			oldExpected, newExpected, err := parseUnifiedDiffHunkHeader(line)
			if err != nil {
				return fmt.Errorf("line %d: %w", index+1, err)
			}
			oldActual, newActual := 0, 0
			body := index + 1
			for ; body < len(lines) && (oldActual < oldExpected || newActual < newExpected); body++ {
				current := strings.TrimSuffix(lines[body], "\r")
				if current == `\ No newline at end of file` {
					continue
				}
				if current == "" {
					return fmt.Errorf("line %d: hunk ended before declared counts old=%d new=%d were satisfied", index+1, oldExpected, newExpected)
				}
				switch current[0] {
				case ' ':
					oldActual++
					newActual++
				case '-':
					oldActual++
				case '+':
					newActual++
				default:
					return fmt.Errorf("line %d: invalid unified diff hunk body line", body+1)
				}
				if oldActual > oldExpected || newActual > newExpected {
					return fmt.Errorf("line %d: hunk body exceeds declared counts old=%d new=%d", index+1, oldExpected, newExpected)
				}
			}
			if oldActual != oldExpected || newActual != newExpected {
				return fmt.Errorf("line %d: hunk count mismatch: declared old=%d new=%d, got old=%d new=%d", index+1, oldExpected, newExpected, oldActual, newActual)
			}
			for body < len(lines) && strings.TrimSuffix(lines[body], "\r") == `\ No newline at end of file` {
				body++
			}
			if body < len(lines) {
				next := strings.TrimSuffix(lines[body], "\r")
				if next != "" && (next[0] == ' ' || next[0] == '+' || next[0] == '-') &&
					!strings.HasPrefix(next, "+++ ") && !strings.HasPrefix(next, "--- ") {
					return fmt.Errorf("line %d: hunk body exceeds declared line counts", body+1)
				}
			}
			index = body - 1
		case line == "":
			// Empty separators and the terminal newline are harmless outside a hunk.
		case strings.HasPrefix(line, `\ No newline at end of file`):
			return fmt.Errorf("line %d: no-newline marker appears outside a hunk", index+1)
		case strings.HasPrefix(line, "+"), strings.HasPrefix(line, "-"), strings.HasPrefix(line, " "):
			if strings.TrimSpace(line) != "" {
				return fmt.Errorf("line %d: patch body line appears outside a hunk", index+1)
			}
		}
	}
	if !sawStructure {
		return errors.New("patch is not a unified diff")
	}
	return nil
}

func canonicalDiffGitPaths(line string) (string, string, error) {
	if strings.ContainsAny(line, "\t\r\n") {
		return "", "", errors.New("Git diff header must use canonical single-space separators")
	}
	parts := strings.Split(line, " ")
	if len(parts) != 4 || parts[0] != "diff" || parts[1] != "--git" || parts[2] == "" || parts[3] == "" {
		return "", "", errors.New("malformed Git diff header")
	}
	if !strings.HasPrefix(parts[2], "a/") || !strings.HasPrefix(parts[3], "b/") {
		return "", "", errors.New("Git diff paths must use canonical a/ and b/ prefixes")
	}
	for _, value := range parts[2:] {
		if strings.ContainsAny(value, `"\\`) {
			return "", "", errors.New("quoted/escaped Git diff paths are denied")
		}
		if err := validatePatchPath(value); err != nil {
			return "", "", err
		}
	}
	return parts[2], parts[3], nil
}

func parseUnifiedDiffHunkHeader(line string) (int, int, error) {
	matches := unifiedDiffHunkHeaderPattern.FindStringSubmatch(line)
	if matches == nil {
		return 0, 0, errors.New("malformed unified diff hunk header")
	}
	oldCount, err := unifiedDiffRangeCount(matches[2])
	if err != nil {
		return 0, 0, err
	}
	newCount, err := unifiedDiffRangeCount(matches[4])
	if err != nil {
		return 0, 0, err
	}
	return oldCount, newCount, nil
}

func unifiedDiffRangeCount(raw string) (int, error) {
	if raw == "" {
		return 1, nil
	}
	count, err := strconv.Atoi(raw)
	if err != nil || count < 0 {
		return 0, errors.New("invalid unified diff hunk count")
	}
	return count, nil
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
	blocked := lower == "version" || lower == ".env" || (strings.HasPrefix(base, ".env.") && !safeEnvTemplate) || lower == ".npmrc" || lower == ".netrc" || lower == ".pypirc" || lower == ".git-credentials" || lower == "credentials.json" || strings.HasPrefix(lower, ".git/") || strings.HasPrefix(lower, ".harness/") || IsWharnexManagedPath(lower) || strings.HasPrefix(lower, ".ssh/") || strings.HasPrefix(lower, ".aws/") || strings.Contains(lower, "/secrets/")
	if blocked {
		return fmt.Errorf("sensitive patch path denied: %s", path)
	}
	return nil
}

// ValidateWorkflowPlan constrains an iterative evidence step. Interactive v1
// remains argv-only/read-only; interactive v2 admits typed capabilities whose
// authority is validated against the explicit capability/scope declaration.
func ValidateWorkflowPlan(plan domain.ExecutionPlan) error {
	if err := Validate(plan); err != nil {
		return err
	}
	if plan.VersionIncrement != nil {
		return errors.New("workflow plan must not contain version_increment")
	}
	if plan.Status != "ready" {
		return errors.New("workflow plan must be ready")
	}
	isV2 := plan.Debug != nil && plan.Debug.Protocol == domain.InteractiveProtocolV2
	if !isV2 {
		if plan.Risk == "high" {
			return errors.New("workflow plan risk must be low or medium")
		}
		if plan.RequiresApproval {
			return errors.New("workflow plan cannot require host approval")
		}
	}
	engineQuery := plan.Debug != nil && strings.TrimSpace(plan.Debug.Query) != ""
	if len(plan.Operations) == 0 && !engineQuery {
		return errors.New("workflow plan requires at least one operation")
	}
	if len(plan.Operations) > 16 {
		return errors.New("workflow plan exceeds 16 operations")
	}
	for i, op := range plan.Operations {
		if op.Type == "apply_patch" {
			return fmt.Errorf("workflow operation %d cannot apply patches", i)
		}
		if !isV2 && op.Type != "command" {
			return fmt.Errorf("workflow operation %d must be command", i)
		}
		if !isV2 && op.Command.Network {
			return fmt.Errorf("workflow operation %d cannot request network access", i)
		}
	}
	if isV2 && len(plan.Verification) != 0 {
		return errors.New("interactive v2 uses typed operations as evidence and does not accept verification commands")
	}
	for i, command := range plan.Verification {
		if command.Network {
			return fmt.Errorf("workflow verification %d cannot request network access", i)
		}
	}
	if plan.Debug != nil {
		if err := ValidateDebugPlan(plan); err != nil {
			return err
		}
	}
	return nil
}

func ValidateDebugPlan(plan domain.ExecutionPlan) error {
	debug := plan.Debug
	if debug == nil {
		return errors.New("debug protocol is required")
	}
	if debug.Protocol != domain.DebugProtocolV1 && debug.Protocol != domain.InteractiveProtocolV1 && debug.Protocol != domain.InteractiveProtocolV2 {
		return fmt.Errorf("unsupported interactive protocol %q", debug.Protocol)
	}
	if debug.Target != "sandbox" && debug.Target != "host" {
		return errors.New("debug target must be sandbox or host")
	}
	access := debug.EffectiveAccess()
	if access != domain.DebugAccessObserve && access != domain.DebugAccessModify {
		return fmt.Errorf("unsupported debug access %q", debug.Access)
	}
	if debug.Protocol != domain.InteractiveProtocolV2 {
		if access == domain.DebugAccessModify {
			return errors.New("host-modifying debug workflows are retired; use harness.interactive/v2")
		}
		if len(debug.Capabilities) != 0 {
			return errors.New("interactive capabilities require harness.interactive/v2")
		}
	} else {
		if access == domain.DebugAccessModify && debug.Target != "host" {
			return errors.New("interactive v2 modify access requires host target")
		}
		if len(debug.Capabilities) == 0 {
			return errors.New("interactive v2 requires capabilities")
		}
		declared := make(map[string]bool, len(debug.Capabilities))
		for _, capability := range debug.Capabilities {
			if !domain.ValidInteractiveCapability(capability) {
				return fmt.Errorf("unsupported interactive capability %q", capability)
			}
			if declared[capability] {
				return fmt.Errorf("duplicate interactive capability %q", capability)
			}
			declared[capability] = true
		}
		for i, op := range plan.Operations {
			capability := interactiveOperationCapability(op.Type)
			if capability == "" || !declared[capability] {
				return fmt.Errorf("workflow operation %d requires undeclared capability %q", i, capability)
			}
			if err := validateInteractiveAccessAndScope(debug, op); err != nil {
				return fmt.Errorf("workflow operation %d: %w", i, err)
			}
		}
		if access == domain.DebugAccessModify && (!plan.RequiresApproval || plan.Risk != "high") {
			return errors.New("interactive v2 modify requires risk=high and requires_approval=true")
		}
	}
	if debug.Query != "" {
		if debug.Query != domain.DebugQueryProjectExecutionSummary {
			return fmt.Errorf("unsupported debug query %q", debug.Query)
		}
		if debug.Target != "host" {
			return errors.New("project execution summary debug query requires host target")
		}
		if access != domain.DebugAccessObserve {
			return errors.New("debug queries are observe-only")
		}
	}
	if rationale := strings.TrimSpace(debug.Rationale); rationale == "" || len(rationale) > 4096 {
		return errors.New("debug rationale must be 1..4096 bytes")
	}
	if debug.Protocol != domain.InteractiveProtocolV2 && debug.Target == "host" {
		for i, op := range plan.Operations {
			if err := validateHostDebugCommand(op.Command); err != nil {
				return fmt.Errorf("debug host operation %d: %w", i, err)
			}
		}
		for i, command := range plan.Verification {
			if err := validateHostDebugCommand(command); err != nil {
				return fmt.Errorf("debug host verification %d: %w", i, err)
			}
		}
	}
	return nil
}

func interactiveOperationCapability(operationType string) string {
	switch operationType {
	case "command", "shell", "sql", "logs", "filesystem", "process", "network", "container", "service":
		return operationType
	default:
		return ""
	}
}

func validateInteractiveAccessAndScope(debug *domain.DebugSpec, op domain.Operation) error {
	modify := debug.EffectiveAccess() == domain.DebugAccessModify
	if debug.Target != "host" {
		switch op.Type {
		case "sql", "logs", "filesystem", "process", "network", "container", "service":
			return fmt.Errorf("interactive %s currently requires host target", op.Type)
		}
	}
	switch op.Type {
	case "command":
		if op.Command.Network && !containsString(debug.Capabilities, domain.InteractiveCapabilityNetwork) {
			return errors.New("command network access requires network capability")
		}
	case "shell":
		if op.Shell.Network && !containsString(debug.Capabilities, domain.InteractiveCapabilityNetwork) {
			return errors.New("shell network access requires network capability")
		}
	case "sql":
		if op.SQL.Mode == "write" && !modify {
			return errors.New("sql write requires modify access")
		}
		if !containsString(debug.Scope.Connections, op.SQL.ConnectionID) {
			return fmt.Errorf("sql connection %q is outside approved scope", op.SQL.ConnectionID)
		}
	case "logs":
		if !containsString(debug.Scope.LogSources, op.Logs.Source) {
			return fmt.Errorf("log source %q is outside approved scope", op.Logs.Source)
		}
		if (op.Logs.Source == "journald" || op.Logs.Source == "service") && !containsString(debug.Scope.Services, op.Logs.Unit) {
			return fmt.Errorf("log unit %q is outside approved service scope", op.Logs.Unit)
		}
		if op.Logs.Source == "container" && !containsString(debug.Scope.Containers, op.Logs.Container) {
			return fmt.Errorf("log container %q is outside approved container scope", op.Logs.Container)
		}
	case "filesystem":
		if (op.Filesystem.Action == "write" || op.Filesystem.Action == "remove" || op.Filesystem.Action == "rename") && !modify {
			return fmt.Errorf("filesystem %s requires modify access", op.Filesystem.Action)
		}
		if !pathWithinInteractiveScope(op.Filesystem.Path, debug.Scope.Paths) {
			return fmt.Errorf("filesystem path %q is outside approved scope", op.Filesystem.Path)
		}
	case "process":
		if op.Process.Action == "signal" && !modify {
			return errors.New("process signal requires modify access")
		}
		processScope := "all"
		if op.Process.Action == "signal" {
			processScope = fmt.Sprintf("%d", op.Process.PID)
		}
		if !containsString(debug.Scope.Processes, processScope) && !containsString(debug.Scope.Processes, "*") {
			return fmt.Errorf("process scope %q is outside approved scope", processScope)
		}
	case "network":
		if !containsString(debug.Scope.NetworkDestinations, op.Network.Address) {
			return fmt.Errorf("network destination %q is outside approved scope", op.Network.Address)
		}
	case "container":
		if (op.Container.Action == "restart" || op.Container.Action == "exec") && !modify {
			return fmt.Errorf("container %s requires modify access", op.Container.Action)
		}
		if !containsString(debug.Scope.Containers, op.Container.Name) {
			return fmt.Errorf("container %q is outside approved scope", op.Container.Name)
		}
	case "service":
		if op.Service.Action == "restart" && !modify {
			return errors.New("service restart requires modify access")
		}
		if !containsString(debug.Scope.Services, op.Service.Name) {
			return fmt.Errorf("service %q is outside approved scope", op.Service.Name)
		}
	}
	return nil
}

func containsString(values []string, want string) bool {
	for _, value := range values {
		if strings.TrimSpace(value) == strings.TrimSpace(want) {
			return true
		}
	}
	return false
}

func pathWithinInteractiveScope(path string, roots []string) bool {
	path = filepath.Clean(strings.TrimSpace(path))
	if path == "." || strings.ContainsRune(path, '\x00') {
		return false
	}
	for _, root := range roots {
		root = filepath.Clean(strings.TrimSpace(root))
		if root == "." || root == "" {
			continue
		}
		if path == root || strings.HasPrefix(path, root+string(filepath.Separator)) {
			return true
		}
	}
	return false
}

func validateHostDebugCommand(command domain.CommandSpec) error {
	if err := ValidateCommand(command); err != nil {
		return err
	}
	name := strings.ToLower(filepath.Base(command.Argv[0]))
	args := command.Argv[1:]
	switch name {
	case "git":
		if len(args) == 0 {
			return errors.New("host debug git requires a bounded read-only subcommand")
		}
		sub := strings.ToLower(args[0])
		rest := args[1:]
		safe := (sub == "status" && allArgsIn(rest, "--short", "--branch", "--porcelain", "--porcelain=v1")) ||
			(sub == "rev-parse" && len(rest) == 1 && allArgsIn(rest, "--show-toplevel", "--is-inside-work-tree", "HEAD")) ||
			(sub == "ls-files" && allArgsIn(rest, "--modified", "--deleted", "--others", "--exclude-standard"))
		if !safe {
			return errors.New("host debug git permits only bounded status, rev-parse or ls-files queries")
		}
	case "go":
		if len(args) == 1 && args[0] == "version" {
			return nil
		}
		if len(args) < 2 || args[0] != "env" {
			return errors.New("host debug permits only go version or bounded go env keys")
		}
		allowed := map[string]bool{"GOMOD": true, "GOPATH": true, "GOCACHE": true, "GOVERSION": true, "GOOS": true, "GOARCH": true, "CGO_ENABLED": true}
		for _, key := range args[1:] {
			if !allowed[key] {
				return fmt.Errorf("go env key %q is not allowed in host debug", key)
			}
		}
	case "node", "npm":
		if len(args) != 1 || (args[0] != "--version" && args[0] != "-v") {
			return fmt.Errorf("host debug permits only %s --version", name)
		}
	case "uname":
		for _, arg := range args {
			if !map[string]bool{"-a": true, "-s": true, "-n": true, "-r": true, "-v": true, "-m": true, "-p": true, "-i": true, "-o": true}[arg] {
				return fmt.Errorf("uname argument %q is not allowed in host debug", arg)
			}
		}
	case "df":
		for _, arg := range args {
			if arg != "-h" && arg != "." {
				return fmt.Errorf("df argument %q is not allowed in host debug", arg)
			}
		}
	case "free":
		if len(args) > 1 || (len(args) == 1 && args[0] != "-h" && args[0] != "-m" && args[0] != "-g") {
			return errors.New("free accepts only -h, -m or -g in host debug")
		}
	case "uptime", "pwd":
		if len(args) != 0 {
			return fmt.Errorf("%s accepts no arguments in host debug", name)
		}
	default:
		return fmt.Errorf("executable %q is not in the host debug read-only allowlist", name)
	}
	return nil
}

func allArgsIn(args []string, allowed ...string) bool {
	set := make(map[string]bool, len(allowed))
	for _, value := range allowed {
		set[value] = true
	}
	for _, value := range args {
		if !set[value] {
			return false
		}
	}
	return true
}
