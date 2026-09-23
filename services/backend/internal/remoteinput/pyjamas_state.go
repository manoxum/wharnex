package remoteinput

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

const pyjamasConfigFileName = "tunnel.conf"

func loadPyjamasConfig(path string) (pyjamasConfig, bool, error) {
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return pyjamasConfig{}, false, nil
	}
	if err != nil {
		return pyjamasConfig{}, false, fmt.Errorf("inspect saved pyjam.as tunnel config: %w", err)
	}
	if !info.Mode().IsRegular() || info.Mode().Perm()&0o077 != 0 {
		return pyjamasConfig{}, false, errors.New("saved pyjam.as tunnel config must be a private regular file")
	}
	if info.Size() > pyjamasMaxConfigBytes {
		return pyjamasConfig{}, false, errors.New("saved pyjam.as tunnel config is too large")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return pyjamasConfig{}, false, fmt.Errorf("read saved pyjam.as tunnel config: %w", err)
	}
	parsed, err := parsePyjamasConfig(string(raw))
	if err != nil {
		return pyjamasConfig{}, false, fmt.Errorf("validate saved pyjam.as tunnel config: %w", err)
	}
	return parsed, true, nil
}

func savePyjamasConfig(path, raw string) error {
	if len(raw) > pyjamasMaxConfigBytes {
		return errors.New("pyjam.as tunnel config is too large")
	}
	temporary, err := os.CreateTemp(filepath.Dir(path), ".tunnel.conf-*")
	if err != nil {
		return fmt.Errorf("create saved pyjam.as tunnel config: %w", err)
	}
	temporaryName := temporary.Name()
	defer os.Remove(temporaryName)
	if err := temporary.Chmod(0o600); err == nil {
		_, err = temporary.WriteString(raw)
	}
	if closeErr := temporary.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return fmt.Errorf("write saved pyjam.as tunnel config: %w", err)
	}
	if err := os.Rename(temporaryName, path); err != nil {
		return fmt.Errorf("persist pyjam.as tunnel config: %w", err)
	}
	return nil
}
