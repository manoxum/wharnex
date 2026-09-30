package protocol

import (
	"errors"
	"fmt"
	"kernl.local/harness/backend/internal/domain"
	"strings"
)

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
