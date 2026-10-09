//go:build linux

package recovery

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// Inspect structural names/states only. The exclusive kernel lease separately
// proves absence of open descriptors, without ptrace access to other programs.
// Any live Git makes the proof conservative across repositories and namespaces.
func processProof(ctx context.Context, proc string, _ os.FileInfo) error {
	processes, err := os.ReadDir(proc)
	if err != nil || len(processes) > 32768 {
		return errors.New("process_visibility_incomplete")
	}
	initName, err := os.ReadFile(filepath.Join(proc, "1", "comm"))
	if err != nil || (strings.TrimSpace(string(initName)) != "systemd" && strings.TrimSpace(string(initName)) != "init") {
		return errors.New("host_process_view_unavailable")
	}
	for _, process := range processes {
		if ctx.Err() != nil {
			return errors.New("cancelled")
		}
		if _, err := strconv.Atoi(process.Name()); err != nil {
			continue
		}
		path := filepath.Join(proc, process.Name())
		name, err := os.ReadFile(filepath.Join(path, "comm"))
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil || len(name) > 256 {
			return errors.New("process_visibility_incomplete")
		}
		status, err := os.ReadFile(filepath.Join(path, "status"))
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil || len(status) > 65536 {
			return errors.New("process_visibility_incomplete")
		}
		state := processState(string(status))
		if state == "" {
			return errors.New("process_visibility_incomplete")
		}
		if state == "Z" || state == "X" {
			continue
		}
		comm := strings.TrimSpace(string(name))
		if comm == "git" || strings.HasPrefix(comm, "git-") {
			return errors.New("git_process_active")
		}
	}
	return nil
}

func processState(status string) string {
	for _, line := range strings.Split(status, "\n") {
		if strings.HasPrefix(line, "State:") {
			fields := strings.Fields(strings.TrimPrefix(line, "State:"))
			if len(fields) > 0 && len(fields[0]) == 1 && strings.Contains("RSDTtZXIP", fields[0]) {
				return fields[0]
			}
		}
	}
	return ""
}
