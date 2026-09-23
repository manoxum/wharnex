package sandbox

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
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
	cmd := exec.Command(shell, interactiveShellArgs(shell)...)
	cmd.Dir = cwd
	cmd.Env = terminalEnvironment(os.Environ(), shell, historyFile)
	return cmd, nil
}

func interactiveShellArgs(shell string) []string {
	if filepath.Base(shell) == "bash" {
		return []string{"-O", "histappend", "--login", "-i"}
	}
	return []string{"-l"}
}

func prepareTerminalHistory(workspace Workspace, shell string) (string, error) {
	projectRoot, err := terminalHistoryProjectRoot(workspace)
	if err != nil {
		return "", err
	}
	dir, err := prepareTerminalHistoryDirectory(projectRoot)
	if err != nil {
		return "", err
	}
	path := filepath.Join(dir, terminalHistoryShellName(shell))
	if info, err := os.Lstat(path); err == nil {
		if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
			return "", errors.New("project terminal history path must be a regular file")
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", fmt.Errorf("inspect project terminal history: %w", err)
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return "", fmt.Errorf("prepare project terminal history: %w", err)
	}
	if err := file.Close(); err != nil {
		return "", fmt.Errorf("close project terminal history: %w", err)
	}
	if err := os.Chmod(path, 0o600); err != nil {
		return "", fmt.Errorf("secure project terminal history: %w", err)
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

func terminalEnvironment(base []string, shell, historyFile string) []string {
	env := append([]string(nil), base...)
	for key, value := range map[string]string{
		"TERM":                     "xterm-256color",
		"COLORTERM":                "truecolor",
		"HISTFILE":                 historyFile,
		"WHARNEX_PROJECT_HISTFILE": historyFile,
	} {
		env = replaceEnvironmentValue(env, key, value)
	}
	if filepath.Base(shell) == "bash" {
		syncHistory := `HISTFILE="$WHARNEX_PROJECT_HISTFILE"; history -a; history -c; history -r "$HISTFILE"`
		if existing := environmentValue(env, "PROMPT_COMMAND"); existing != "" {
			syncHistory += "; " + existing
		}
		env = replaceEnvironmentValue(env, "PROMPT_COMMAND", syncHistory)
	}
	return env
}

func environmentValue(env []string, key string) string {
	prefix := key + "="
	for _, entry := range env {
		if strings.HasPrefix(entry, prefix) {
			return strings.TrimPrefix(entry, prefix)
		}
	}
	return ""
}

func replaceEnvironmentValue(env []string, key, value string) []string {
	prefix := key + "="
	filtered := env[:0]
	for _, entry := range env {
		if !strings.HasPrefix(entry, prefix) {
			filtered = append(filtered, entry)
		}
	}
	return append(filtered, prefix+value)
}
