package sandbox

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"kernl.local/harness/backend/internal/sandbox/terminalinit"
)

const terminalHistoryRelativeDir = ".harness/terminal/history"

func terminalShell() string {
	if shell := strings.TrimSpace(os.Getenv("SHELL")); filepath.IsAbs(shell) {
		if info, err := os.Stat(shell); err == nil && !info.IsDir() && info.Mode()&0o111 != 0 {
			return shell
		}
	}
	for _, shell := range []string{"/bin/bash", "/bin/sh"} {
		if _, err := os.Stat(shell); err == nil {
			return shell
		}
	}
	return "/bin/sh"
}

func localTerminalCommand(workspace Workspace, options TerminalOptions) (*exec.Cmd, error) {
	cwd, err := safeWorkspaceCwd(workspace.Path, options.Cwd)
	if err != nil {
		return nil, err
	}
	shell := terminalShell()
	historyFile, err := prepareTerminalHistory(workspace, shell)
	if err != nil {
		return nil, err
	}
	wharnexHistoryFile, err := prepareWharnexTerminalHistory()
	if err != nil {
		return nil, err
	}
	historyDir := filepath.Dir(historyFile)
	sessionHistoryFile, err := prepareTerminalSessionHistory(historyDir, options.ID)
	if err != nil {
		return nil, err
	}
	terminalDir := filepath.Dir(historyDir)
	args := []string{"-l"}
	env := terminalEnvironment(os.Environ(), historyFile, wharnexHistoryFile, sessionHistoryFile)
	switch {
	case terminalinit.IsBashShell(shell):
		initFile, err := terminalinit.PrepareBash(terminalDir)
		if err != nil {
			return nil, err
		}
		args = terminalinit.BashArgs(initFile)
	case terminalinit.IsZshShell(shell):
		zdotdir, err := terminalinit.PrepareZsh(terminalDir)
		if err != nil {
			return nil, err
		}
		env = terminalinit.ZshEnvironment(env, zdotdir)
	}
	cmd := exec.Command(shell, args...)
	cmd.Dir = cwd
	cmd.Env = env
	return cmd, nil
}

func prepareTerminalHistory(workspace Workspace, shell string) (string, error) {
	projectRoot, err := terminalHistoryProjectRoot(workspace)
	if err != nil {
		return "", err
	}
	if err := ensureTerminalRuntimeGitExclude(projectRoot); err != nil {
		return "", err
	}
	dir, err := prepareTerminalHistoryDirectory(projectRoot)
	if err != nil {
		return "", err
	}
	return prepareTerminalHistoryFile(dir, terminalHistoryShellName(shell), "project")
}

func prepareTerminalHistoryFile(dir, name, scope string) (string, error) {
	path := filepath.Join(dir, name)
	if info, err := os.Lstat(path); err == nil {
		if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
			return "", fmt.Errorf("%s terminal history path must be a regular file", scope)
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", fmt.Errorf("inspect %s terminal history: %w", scope, err)
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return "", fmt.Errorf("prepare %s terminal history: %w", scope, err)
	}
	if err := file.Close(); err != nil {
		return "", fmt.Errorf("close %s terminal history: %w", scope, err)
	}
	if err := os.Chmod(path, 0o600); err != nil {
		return "", fmt.Errorf("secure %s terminal history: %w", scope, err)
	}
	return path, nil
}

func prepareTerminalHistoryDirectory(projectRoot string) (string, error) {
	current := projectRoot
	for _, part := range strings.Split(terminalHistoryRelativeDir, "/") {
		current = filepath.Join(current, part)
		info, err := os.Lstat(current)
		if err == nil {
			if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
				return "", fmt.Errorf("project terminal history directory component %q must be a real directory", current)
			}
			continue
		}
		if !errors.Is(err, os.ErrNotExist) {
			return "", fmt.Errorf("inspect project terminal history directory: %w", err)
		}
		if err := os.Mkdir(current, 0o700); err != nil {
			return "", fmt.Errorf("prepare project terminal history directory: %w", err)
		}
	}
	if err := os.Chmod(current, 0o700); err != nil {
		return "", fmt.Errorf("secure project terminal history directory: %w", err)
	}
	return current, nil
}

func terminalHistoryProjectRoot(workspace Workspace) (string, error) {
	for _, candidate := range []string{workspace.ProjectPath, workspace.SourcePath, workspace.Path} {
		candidate = strings.TrimSpace(candidate)
		if candidate == "" {
			continue
		}
		absolute, err := filepath.Abs(candidate)
		if err != nil {
			return "", fmt.Errorf("resolve project root for terminal history: %w", err)
		}
		return filepath.Clean(absolute), nil
	}
	return "", errors.New("project root is required for terminal history")
}

func terminalHistoryShellName(shell string) string {
	name := strings.ToLower(filepath.Base(strings.TrimSpace(shell)))
	if name == "" || name == "." || name == string(filepath.Separator) {
		return "shell"
	}
	var safe strings.Builder
	for _, r := range name {
		if r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '-' || r == '_' || r == '.' {
			safe.WriteRune(r)
		}
	}
	if safe.Len() == 0 {
		return "shell"
	}
	return safe.String()
}
