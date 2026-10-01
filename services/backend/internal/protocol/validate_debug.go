package protocol

import (
	"errors"
	"fmt"
	"kernl.local/harness/backend/internal/domain"
	"path/filepath"
	"strings"
)

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
