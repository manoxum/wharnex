package sandbox

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const wharnexTerminalHistoryDirName = "wharnex"

func prepareWharnexTerminalHistory() (string, error) {
	root, err := wharnexTerminalHistoryRoot()
	if err != nil {
		return "", err
	}
	if root == "" {
		return "", nil
	}
	dir, err := prepareTerminalHistoryDirectory(root)
	if err != nil {
		return "", err
	}
	dir = filepath.Join(dir, wharnexTerminalHistoryDirName)
	if info, err := os.Lstat(dir); err == nil {
		if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
			return "", fmt.Errorf("Wharnex terminal history directory %q must be a real directory", dir)
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", fmt.Errorf("inspect Wharnex terminal history directory: %w", err)
	} else if err := os.Mkdir(dir, 0o700); err != nil {
		return "", fmt.Errorf("prepare Wharnex terminal history directory: %w", err)
	}
	if err := os.Chmod(dir, 0o700); err != nil {
		return "", fmt.Errorf("secure Wharnex terminal history directory: %w", err)
	}
	return prepareTerminalHistoryFile(dir, "commands", "Wharnex")
}

func wharnexTerminalHistoryRoot() (string, error) {
	root := strings.TrimSpace(os.Getenv("WHARNESS_ROOT"))
	if root == "" {
		return "", nil
	}
	absolute, err := filepath.Abs(root)
	if err != nil {
		return "", fmt.Errorf("resolve Wharnex root for terminal history: %w", err)
	}
	return filepath.Clean(absolute), nil
}

func prepareTerminalSessionHistory(historyDir, terminalID string) (string, error) {
	name := ".session-" + sanitizeContainerName(terminalID)
	return prepareTerminalHistoryFile(historyDir, name, "terminal session")
}

func terminalEnvironment(base []string, projectHistoryFile, wharnexHistoryFile, sessionHistoryFile string) []string {
	env := append([]string(nil), base...)
	osHistoryFile := environmentValue(base, "HISTFILE")
	for key, value := range map[string]string{
		"TERM":                     "xterm-256color",
		"COLORTERM":                "truecolor",
		"HISTFILE":                 projectHistoryFile,
		"WHARNEX_PROJECT_HISTFILE": projectHistoryFile,
		"WHARNEX_GLOBAL_HISTFILE":  wharnexHistoryFile,
		"WHARNEX_SESSION_HISTFILE": sessionHistoryFile,
		"WHARNEX_OS_HISTFILE":      osHistoryFile,
	} {
		env = replaceEnvironmentValue(env, key, value)
	}
	return env
}
