package app

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/ids"
	"kernl.local/harness/backend/internal/sandbox"
)

const interactiveOutputLimit = 96 << 10

var interactiveSecret = regexp.MustCompile(`(?i)(api[_-]?key|token|password|secret)\s*[:=]\s*[^\s]+`)

func (s *Service) executeInteractiveV2Plan(ctx context.Context, sessionID string, plan domain.ExecutionPlan, decision domain.PolicyDecision, transport string) (domain.ExecutionResult, error) {
	runCtx, cancel := context.WithCancel(ctx)
	s.interactiveCancelMu.Lock()
	if previous := s.interactiveCancels[sessionID]; previous != nil {
		previous()
	}
	s.interactiveCancels[sessionID] = cancel
	s.interactiveCancelMu.Unlock()
	defer func() {
		cancel()
		s.interactiveCancelMu.Lock()
		delete(s.interactiveCancels, sessionID)
		s.interactiveCancelMu.Unlock()
	}()
	ctx = runCtx
	current, err := s.store.Get(sessionID)
	if err != nil {
		return domain.ExecutionResult{}, err
	}
	if !interactiveGrantCovers(current, &plan) {
		return domain.ExecutionResult{}, errors.New("interactive v2 grant does not cover the exact plan/scope")
	}

	result := domain.ExecutionResult{PlanID: plan.PlanID, StartedAt: time.Now().UTC(), Commands: []domain.CommandResult{}, Interactive: []domain.InteractiveOperationResult{}}
	s.bus.Publish(sessionID, "workflow.started", map[string]any{"plan_id": plan.PlanID, "transport": transport, "round": current.WorkflowRound + 1, "protocol": domain.InteractiveProtocolV2})

	var runner sandbox.Runner = s.runner
	target := "interactive-sandbox"
	if plan.Debug.Target == "host" {
		runner, target = s.hostRunner, "interactive-host"
	}
	needsWorkspace := false
	for _, op := range plan.Operations {
		if op.Type == "command" || op.Type == "shell" || op.Type == "logs" || op.Type == "container" || op.Type == "service" {
			needsWorkspace = true
			break
		}
	}
	var workspace sandbox.Workspace
	if needsWorkspace {
		workspace, err = runner.Prepare(ctx, current.ProjectPath)
		if err != nil {
			result.Error = err.Error()
			result.CompletedAt = time.Now().UTC()
			return result, err
		}
		defer runner.Cleanup(workspace)
	}

	for index, op := range plan.Operations {
		operationID := fmt.Sprintf("op-%02d-%s", index+1, ids.New("iv2"))
		started := time.Now().UTC()
		digest := interactiveOperationDigest(op)
		s.bus.Publish(sessionID, "interactive.operation_started", map[string]any{"plan_id": plan.PlanID, "operation_id": operationID, "capability": op.Type, "target": plan.Debug.Target, "digest": digest})
		opResult, commandResult, opErr := s.executeInteractiveOperation(ctx, sessionID, current, plan, op, operationID, runner, workspace, target)
		opResult.StartedAt = started
		opResult.CompletedAt = time.Now().UTC()
		if commandResult != nil {
			result.Commands = append(result.Commands, *commandResult)
		}
		result.Interactive = append(result.Interactive, opResult)
		s.bus.Publish(sessionID, "interactive.operation_completed", map[string]any{
			"plan_id": plan.PlanID, "operation_id": operationID, "capability": opResult.Capability, "digest": digest,
			"status": opResult.Status, "bytes": opResult.Bytes, "rows": opResult.Rows,
			"truncated": opResult.Truncated, "redacted": opResult.Redacted, "error": opResult.Error,
		})
		if opErr != nil {
			result.Success = false
			result.Error = opErr.Error()
			result.CompletedAt = time.Now().UTC()
			s.storeWorkflowObservation(sessionID, result, decision)
			return result, opErr
		}
	}
	for _, command := range plan.Verification {
		commandResult, runErr := s.runInteractiveCommandWithRunner(ctx, sessionID, runner, workspace, command, target)
		result.Commands = append(result.Commands, commandResult)
		if runErr != nil || !commandResult.Success {
			if runErr == nil {
				runErr = fmt.Errorf("workflow verification exited with %d", commandResult.ExitCode)
			}
			result.Success = false
			result.Error = runErr.Error()
			result.CompletedAt = time.Now().UTC()
			s.storeWorkflowObservation(sessionID, result, decision)
			return result, runErr
		}
	}
	result.Success = true
	result.CompletedAt = time.Now().UTC()
	s.storeWorkflowObservation(sessionID, result, decision)
	s.bus.Publish(sessionID, "workflow.completed", map[string]any{"plan_id": plan.PlanID, "commands": len(result.Commands), "interactive_operations": len(result.Interactive), "transport": transport, "target": target})
	return result, nil
}

func interactiveOperationDigest(op domain.Operation) string {
	raw, _ := json.Marshal(op)
	digest := sha256.Sum256(raw)
	return hex.EncodeToString(digest[:])
}

func (s *Service) runInteractiveCommandWithRunner(ctx context.Context, sessionID string, runner sandbox.Runner, workspace sandbox.Workspace, command domain.CommandSpec, target string) (domain.CommandResult, error) {
	command = repositoryTreeCommand(ctx, workspace.Path, command)
	runID := ids.New("interactive-run")
	s.bus.Publish(sessionID, "command.started", map[string]any{"run_id": runID, "argv": command.Argv, "cwd": command.Cwd, "network": command.Network, "timeout_seconds": command.TimeoutSeconds, "target": target, "interactive": true})
	result, err := runner.Run(ctx, workspace, command)
	result = normalizePreflightCommandFailure(command, result, err)
	if err == nil && !result.Success && result.ExitCode == -1 && ctx.Err() != nil {
		err = ctx.Err()
	}
	stdout, stdoutTruncated, stdoutRedacted := sanitizeInteractiveOutput(result.Stdout)
	stderr, stderrTruncated, stderrRedacted := sanitizeInteractiveOutput(result.Stderr)
	result.Stdout, result.Stderr = stdout, stderr
	s.bus.Publish(sessionID, "command.completed", map[string]any{"run_id": runID, "argv": command.Argv, "cwd": command.Cwd, "exit_code": result.ExitCode, "success": result.Success, "stdout": stdout, "stderr": stderr, "duration_ms": result.DurationMS, "target": target, "interactive": true, "truncated": stdoutTruncated || stderrTruncated, "redacted": stdoutRedacted || stderrRedacted})
	return result, err
}

func (s *Service) executeInteractiveOperation(ctx context.Context, sessionID string, current domain.Session, plan domain.ExecutionPlan, op domain.Operation, operationID string, runner sandbox.Runner, workspace sandbox.Workspace, target string) (domain.InteractiveOperationResult, *domain.CommandResult, error) {
	base := domain.InteractiveOperationResult{OperationID: operationID, Type: op.Type, Capability: op.Type, Target: plan.Debug.Target, Status: "completed"}
	switch op.Type {
	case "command":
		res, err := s.runInteractiveCommandWithRunner(ctx, sessionID, runner, workspace, op.Command, target)
		base.Output, base.Truncated, base.Redacted = sanitizeInteractiveOutput(res.Stdout + joinedStderr(res.Stderr))
		base.Bytes = len(base.Output)
		if err != nil || !res.Success {
			if err == nil {
				err = fmt.Errorf("command exited with %d", res.ExitCode)
			}
			base.Status = "failed"
			base.Error = err.Error()
			return base, &res, err
		}
		return base, &res, nil
	case "shell":
		res, err := s.executeInteractiveShell(ctx, sessionID, runner, workspace, *op.Shell, target, plan.Debug.Target == "host")
		base.Output, base.Truncated, base.Redacted = sanitizeInteractiveOutput(res.Stdout + joinedStderr(res.Stderr))
		base.Bytes = len(base.Output)
		if err != nil || !res.Success {
			if err == nil {
				err = fmt.Errorf("shell exited with %d", res.ExitCode)
			}
			base.Status = "failed"
			base.Error = err.Error()
			return base, &res, err
		}
		return base, &res, nil
	case "sql":
		connection, ok := s.interactivePostgresConnection(op.SQL.ConnectionID)
		if !ok {
			return failedInteractive(base, fmt.Errorf("interactive database connection %q is not registered", op.SQL.ConnectionID))
		}
		query, err := s.queryPostgresWithLimits(ctx, connection, op.SQL.Statement, op.SQL.Mode == "read_only", time.Duration(op.SQL.TimeoutSeconds)*time.Second, op.SQL.MaxRows)
		if err != nil {
			return failedInteractive(base, err)
		}
		raw, _ := json.Marshal(query)
		base.Output, base.Truncated, base.Redacted = sanitizeInteractiveOutput(string(raw))
		base.Bytes = len(base.Output)
		base.Rows = query.RowCount
		return base, nil, nil
	case "logs":
		output, err := s.readInteractiveLogs(ctx, sessionID, current, *op.Logs, plan.Debug.Scope, runner, workspace, target)
		if err != nil {
			return failedInteractive(base, err)
		}
		base.Output, base.Truncated, base.Redacted = sanitizeInteractiveOutput(output)
		base.Bytes = len(base.Output)
		return base, nil, nil
	case "filesystem":
		output, err := executeInteractiveFilesystem(current.ProjectPath, *op.Filesystem, plan.Debug.Scope)
		if err != nil {
			return failedInteractive(base, err)
		}
		base.Output, base.Truncated, base.Redacted = sanitizeInteractiveOutput(output)
		base.Bytes = len(base.Output)
		return base, nil, nil
	case "process":
		output, err := executeInteractiveProcess(*op.Process)
		if err != nil {
			return failedInteractive(base, err)
		}
		base.Output, base.Truncated, base.Redacted = sanitizeInteractiveOutput(output)
		base.Bytes = len(base.Output)
		return base, nil, nil
	case "network":
		output, err := executeInteractiveNetwork(ctx, *op.Network)
		if err != nil {
			return failedInteractive(base, err)
		}
		base.Output = output
		base.Bytes = len(output)
		return base, nil, nil
	case "container":
		command := interactiveContainerCommand(*op.Container)
		res, err := s.runInteractiveCommandWithRunner(ctx, sessionID, runner, workspace, command, target)
		base.Output, base.Truncated, base.Redacted = sanitizeInteractiveOutput(res.Stdout + joinedStderr(res.Stderr))
		base.Bytes = len(base.Output)
		if err != nil || !res.Success {
			if err == nil {
				err = fmt.Errorf("container action exited with %d", res.ExitCode)
			}
			base.Status = "failed"
			base.Error = err.Error()
			return base, &res, err
		}
		return base, &res, nil
	case "service":
		command := interactiveServiceCommand(*op.Service)
		res, err := s.runInteractiveCommandWithRunner(ctx, sessionID, runner, workspace, command, target)
		base.Output, base.Truncated, base.Redacted = sanitizeInteractiveOutput(res.Stdout + joinedStderr(res.Stderr))
		base.Bytes = len(base.Output)
		if err != nil || !res.Success {
			if err == nil {
				err = fmt.Errorf("service action exited with %d", res.ExitCode)
			}
			base.Status = "failed"
			base.Error = err.Error()
			return base, &res, err
		}
		return base, &res, nil
	default:
		return failedInteractive(base, fmt.Errorf("unsupported interactive operation %q", op.Type))
	}
}

func (s *Service) CancelInteractiveV2(sessionID string) bool {
	s.interactiveCancelMu.Lock()
	cancel := s.interactiveCancels[sessionID]
	s.interactiveCancelMu.Unlock()
	if cancel == nil {
		return false
	}
	cancel()
	s.bus.Publish(sessionID, "interactive.cancel_requested", map[string]any{"source": "operator"})
	return true
}

func failedInteractive(base domain.InteractiveOperationResult, err error) (domain.InteractiveOperationResult, *domain.CommandResult, error) {
	base.Status = "failed"
	base.Error = err.Error()
	return base, nil, err
}

func joinedStderr(stderr string) string {
	if strings.TrimSpace(stderr) == "" {
		return ""
	}
	return "\nSTDERR:\n" + stderr
}

func sanitizeInteractiveOutput(value string) (string, bool, bool) {
	redacted := interactiveSecret.ReplaceAllString(value, "$1=[REDACTED]")
	wasRedacted := redacted != value
	if len(redacted) > interactiveOutputLimit {
		return redacted[:interactiveOutputLimit] + "…[truncated]", true, wasRedacted
	}
	return redacted, false, wasRedacted
}

func (s *Service) executeInteractiveShell(ctx context.Context, sessionID string, runner sandbox.Runner, workspace sandbox.Workspace, spec domain.InteractiveShellSpec, target string, host bool) (domain.CommandResult, error) {
	var path string
	var cleanup func()
	if host {
		file, err := os.CreateTemp("", "wharnex-interactive-*.sh")
		if err != nil {
			return domain.CommandResult{}, err
		}
		path = file.Name()
		cleanup = func() { _ = os.Remove(path) }
		if err := file.Chmod(0o600); err != nil {
			_ = file.Close()
			cleanup()
			return domain.CommandResult{}, err
		}
		if _, err := file.WriteString(spec.Script); err != nil {
			_ = file.Close()
			cleanup()
			return domain.CommandResult{}, err
		}
		if err := file.Close(); err != nil {
			cleanup()
			return domain.CommandResult{}, err
		}
	} else {
		name := ".wharnex-interactive-" + ids.New("script") + ".sh"
		dir, err := safeInteractiveWorkspaceCwd(workspace.Path, spec.Cwd)
		if err != nil {
			return domain.CommandResult{}, err
		}
		path = filepath.Join(dir, name)
		cleanup = func() { _ = os.Remove(path) }
		if err := os.WriteFile(path, []byte(spec.Script), 0o600); err != nil {
			return domain.CommandResult{}, err
		}
		path = name
	}
	defer cleanup()
	envAllowlist := make([]string, len(spec.EnvAllowlist))
	copy(envAllowlist, spec.EnvAllowlist)
	command := domain.CommandSpec{Argv: []string{spec.Shell, path}, Cwd: spec.Cwd, TimeoutSeconds: spec.TimeoutSeconds, Network: spec.Network, ExpectedExitCodes: []int{0}, EnvAllowlist: envAllowlist}
	return s.runInteractiveCommandWithRunner(ctx, sessionID, runner, workspace, command, target)
}

func safeInteractiveWorkspaceCwd(root, cwd string) (string, error) {
	if strings.TrimSpace(cwd) == "" || cwd == "." {
		return root, nil
	}
	clean := filepath.Clean(cwd)
	if filepath.IsAbs(clean) || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return "", errors.New("interactive shell cwd escapes workspace")
	}
	path := filepath.Join(root, clean)
	rel, err := filepath.Rel(root, path)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", errors.New("interactive shell cwd escapes workspace")
	}
	return path, nil
}

func (s *Service) readInteractiveLogs(ctx context.Context, sessionID string, current domain.Session, spec domain.InteractiveLogsSpec, scope domain.InteractiveScope, runner sandbox.Runner, workspace sandbox.Workspace, target string) (string, error) {
	switch spec.Source {
	case "audit", "wharnex-backend":
		events := s.bus.History(current.ID)
		if len(events) > spec.Limit {
			events = events[len(events)-spec.Limit:]
		}
		if spec.Filter != "" {
			filtered := events[:0]
			for _, event := range events {
				raw, _ := json.Marshal(event)
				if strings.Contains(strings.ToLower(string(raw)), strings.ToLower(spec.Filter)) {
					filtered = append(filtered, event)
				}
			}
			events = filtered
		}
		raw, err := json.Marshal(events)
		return string(raw), err
	case "file", "desktop":
		if strings.TrimSpace(spec.Path) == "" {
			return "", errors.New("file/desktop log source requires path")
		}
		path, err := resolveInteractivePath(current.ProjectPath, spec.Path, scope.Paths, false)
		if err != nil {
			return "", err
		}
		return tailFile(path, spec.Limit, spec.Filter)
	case "journald", "service":
		if strings.TrimSpace(spec.Unit) == "" {
			return "", errors.New("journald/service log source requires unit")
		}
		argv := []string{"journalctl", "--no-pager", "-n", strconv.Itoa(spec.Limit), "-u", spec.Unit}
		if spec.Since != "" {
			argv = append(argv, "--since", spec.Since)
		}
		if spec.Until != "" {
			argv = append(argv, "--until", spec.Until)
		}
		res, err := s.runInteractiveCommandWithRunner(ctx, sessionID, runner, workspace, domain.CommandSpec{Argv: argv, Cwd: ".", TimeoutSeconds: 60, ExpectedExitCodes: []int{0}}, target)
		if err != nil || !res.Success {
			if err == nil {
				err = fmt.Errorf("journalctl exited with %d", res.ExitCode)
			}
			return "", err
		}
		return filterInteractiveLines(res.Stdout, spec.Filter, spec.Limit), nil
	case "container":
		if strings.TrimSpace(spec.Container) == "" {
			return "", errors.New("container log source requires container")
		}
		argv := []string{"docker", "logs", "--tail", strconv.Itoa(spec.Limit)}
		if spec.Since != "" {
			argv = append(argv, "--since", spec.Since)
		}
		if spec.Until != "" {
			argv = append(argv, "--until", spec.Until)
		}
		argv = append(argv, spec.Container)
		res, err := s.runInteractiveCommandWithRunner(ctx, sessionID, runner, workspace, domain.CommandSpec{Argv: argv, Cwd: ".", TimeoutSeconds: 60, ExpectedExitCodes: []int{0}}, target)
		if err != nil || !res.Success {
			if err == nil {
				err = fmt.Errorf("docker logs exited with %d", res.ExitCode)
			}
			return "", err
		}
		return filterInteractiveLines(res.Stdout+joinedStderr(res.Stderr), spec.Filter, spec.Limit), nil
	default:
		return "", fmt.Errorf("log source %q has no configured adapter", spec.Source)
	}
}

func filterInteractiveLines(value, filter string, limit int) string {
	lines := strings.Split(strings.ReplaceAll(value, "\r\n", "\n"), "\n")
	out := make([]string, 0, minInt(limit, len(lines)))
	for _, line := range lines {
		if filter != "" && !strings.Contains(strings.ToLower(line), strings.ToLower(filter)) {
			continue
		}
		if len(out) == limit {
			copy(out, out[1:])
			out[len(out)-1] = line
		} else {
			out = append(out, line)
		}
	}
	return strings.Join(out, "\n")
}

func tailFile(path string, limit int, filter string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	lines := make([]string, 0, limit)
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 64<<10), 1<<20)
	for scanner.Scan() {
		line := scanner.Text()
		if filter != "" && !strings.Contains(strings.ToLower(line), strings.ToLower(filter)) {
			continue
		}
		if len(lines) == limit {
			copy(lines, lines[1:])
			lines[len(lines)-1] = line
		} else {
			lines = append(lines, line)
		}
	}
	if err := scanner.Err(); err != nil {
		return "", err
	}
	return strings.Join(lines, "\n"), nil
}

func executeInteractiveFilesystem(projectRoot string, spec domain.InteractiveFilesystemSpec, scope domain.InteractiveScope) (string, error) {
	write := spec.Action == "write" || spec.Action == "remove" || spec.Action == "rename"
	path, err := resolveInteractivePath(projectRoot, spec.Path, scope.Paths, write)
	if err != nil {
		return "", err
	}
	switch spec.Action {
	case "stat":
		info, err := os.Stat(path)
		if err != nil {
			return "", err
		}
		raw, _ := json.Marshal(map[string]any{"name": info.Name(), "size": info.Size(), "mode": info.Mode().String(), "modified": info.ModTime(), "dir": info.IsDir()})
		return string(raw), nil
	case "list":
		items, err := os.ReadDir(path)
		if err != nil {
			return "", err
		}
		if len(items) > 1000 {
			items = items[:1000]
		}
		names := make([]string, 0, len(items))
		for _, item := range items {
			names = append(names, item.Name())
		}
		return strings.Join(names, "\n"), nil
	case "read":
		max := spec.MaxBytes
		if max <= 0 {
			max = 256 << 10
		}
		file, err := os.Open(path)
		if err != nil {
			return "", err
		}
		defer file.Close()
		data := make([]byte, max+1)
		n, err := file.Read(data)
		if err != nil && n == 0 {
			return "", err
		}
		if n > max {
			n = max
		}
		return string(data[:n]), nil
	case "write":
		if err := os.WriteFile(path, []byte(spec.Content), 0o600); err != nil {
			return "", err
		}
		return fmt.Sprintf("wrote %d bytes", len(spec.Content)), nil
	case "remove":
		if err := os.Remove(path); err != nil {
			return "", err
		}
		return "removed", nil
	case "rename":
		parts := strings.SplitN(spec.Content, "\n", 2)
		if len(parts) == 0 || strings.TrimSpace(parts[0]) == "" {
			return "", errors.New("rename requires destination path in content")
		}
		dest, err := resolveInteractivePath(projectRoot, strings.TrimSpace(parts[0]), scope.Paths, true)
		if err != nil {
			return "", err
		}
		if err := os.Rename(path, dest); err != nil {
			return "", err
		}
		return "renamed", nil
	default:
		return "", fmt.Errorf("unsupported filesystem action %q", spec.Action)
	}
}

func resolveInteractivePath(projectRoot, raw string, roots []string, writing bool) (string, error) {
	if interactiveSensitivePath(raw) {
		return "", fmt.Errorf("sensitive interactive path denied: %s", raw)
	}
	if strings.ContainsRune(raw, '\x00') {
		return "", errors.New("path contains NUL")
	}
	candidate := filepath.Clean(strings.TrimSpace(raw))
	if candidate == "." || candidate == "" {
		return "", errors.New("path is empty")
	}
	if !filepath.IsAbs(candidate) {
		candidate = filepath.Join(projectRoot, candidate)
	}
	candidate, err := filepath.Abs(candidate)
	if err != nil {
		return "", err
	}
	var canonical string
	if writing {
		parent, err := filepath.EvalSymlinks(filepath.Dir(candidate))
		if err != nil {
			return "", err
		}
		canonical = filepath.Join(parent, filepath.Base(candidate))
	} else {
		canonical, err = filepath.EvalSymlinks(candidate)
		if err != nil {
			return "", err
		}
	}
	for _, root := range roots {
		scoped := filepath.Clean(root)
		if !filepath.IsAbs(scoped) {
			scoped = filepath.Join(projectRoot, scoped)
		}
		scoped, err = filepath.Abs(scoped)
		if err != nil {
			continue
		}
		resolvedRoot, evalErr := filepath.EvalSymlinks(scoped)
		if evalErr == nil {
			scoped = resolvedRoot
		}
		if canonical == scoped || strings.HasPrefix(canonical, scoped+string(filepath.Separator)) {
			return canonical, nil
		}
	}
	return "", fmt.Errorf("path %q escaped the approved interactive scope", raw)
}

func interactiveSensitivePath(raw string) bool {
	clean := strings.ToLower(filepath.ToSlash(filepath.Clean(strings.TrimSpace(raw))))
	base := filepath.Base(clean)
	safeTemplate := base == ".env.example" || base == ".env.sample" || base == ".env.template"
	return clean == ".env" || (strings.HasPrefix(base, ".env.") && !safeTemplate) || base == ".npmrc" || base == ".netrc" || base == ".pypirc" || base == ".git-credentials" || base == "credentials.json" || strings.Contains(clean, "/.ssh/") || strings.HasPrefix(clean, ".ssh/") || strings.Contains(clean, "/.aws/") || strings.HasPrefix(clean, ".aws/") || strings.Contains(clean, "/secrets/")
}

func executeInteractiveProcess(spec domain.InteractiveProcessSpec) (string, error) {
	if spec.Action == "list" {
		entries, err := os.ReadDir("/proc")
		if err != nil {
			return "", err
		}
		rows := make([]string, 0, 256)
		for _, entry := range entries {
			if len(rows) >= 256 {
				break
			}
			if _, err := strconv.Atoi(entry.Name()); err != nil {
				continue
			}
			data, err := os.ReadFile(filepath.Join("/proc", entry.Name(), "comm"))
			if err == nil {
				rows = append(rows, entry.Name()+"\t"+strings.TrimSpace(string(data)))
			}
		}
		return strings.Join(rows, "\n"), nil
	}
	sig, err := parseSignal(spec.Signal)
	if err != nil {
		return "", err
	}
	process, err := os.FindProcess(spec.PID)
	if err != nil {
		return "", err
	}
	if err := process.Signal(sig); err != nil {
		return "", err
	}
	return fmt.Sprintf("signal %s sent to %d", spec.Signal, spec.PID), nil
}

func parseSignal(value string) (os.Signal, error) {
	switch strings.ToUpper(strings.TrimPrefix(value, "SIG")) {
	case "TERM":
		return syscall.SIGTERM, nil
	case "INT":
		return syscall.SIGINT, nil
	case "HUP":
		return syscall.SIGHUP, nil
	default:
		return nil, fmt.Errorf("signal %q is not allowed", value)
	}
}

func executeInteractiveNetwork(ctx context.Context, spec domain.InteractiveNetworkSpec) (string, error) {
	dialer := net.Dialer{Timeout: time.Duration(spec.TimeoutSeconds) * time.Second}
	conn, err := dialer.DialContext(ctx, "tcp", spec.Address)
	if err != nil {
		return "", err
	}
	defer conn.Close()
	return "tcp connection succeeded to " + spec.Address, nil
}

func interactiveContainerCommand(spec domain.InteractiveContainerSpec) domain.CommandSpec {
	timeout := spec.TimeoutSeconds
	if timeout <= 0 {
		timeout = 60
	}
	argv := []string{"docker"}
	switch spec.Action {
	case "inspect":
		argv = append(argv, "inspect", spec.Name)
	case "logs":
		argv = append(argv, "logs", "--tail", strconv.Itoa(maxInt(spec.Tail, 200)), spec.Name)
	case "restart":
		argv = append(argv, "restart", spec.Name)
	case "exec":
		argv = append(argv, "exec", spec.Name)
		argv = append(argv, spec.Argv...)
	}
	return domain.CommandSpec{Argv: argv, Cwd: ".", TimeoutSeconds: timeout, Network: false, ExpectedExitCodes: []int{0}}
}

func interactiveServiceCommand(spec domain.InteractiveServiceSpec) domain.CommandSpec {
	argv := []string{"systemctl", spec.Action, spec.Name}
	return domain.CommandSpec{Argv: argv, Cwd: ".", TimeoutSeconds: 60, Network: false, ExpectedExitCodes: []int{0}}
}

func maxInt(value, fallback int) int {
	if value > 0 {
		return value
	}
	return fallback
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func sortedInteractiveScope(scope domain.InteractiveScope) domain.InteractiveScope {
	out := scope
	sort.Strings(out.Paths)
	sort.Strings(out.Connections)
	sort.Strings(out.LogSources)
	sort.Strings(out.Processes)
	sort.Strings(out.Services)
	sort.Strings(out.Containers)
	sort.Strings(out.NetworkDestinations)
	return out
}
