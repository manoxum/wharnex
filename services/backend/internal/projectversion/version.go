package projectversion

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

const (
	FileName       = "VERSION"
	InitialVersion = "v0.0.0.0"
)

type Increment struct {
	Component string
	Amount    int
}

func Ensure(root string) (string, bool, error) {
	path := filepath.Join(root, FileName)
	raw, err := os.ReadFile(path)
	if err == nil {
		return strings.TrimSpace(string(raw)), false, nil
	}
	if !os.IsNotExist(err) {
		return "", false, fmt.Errorf("read %s: %w", FileName, err)
	}
	if err := write(path, InitialVersion); err != nil {
		return "", false, err
	}
	return InitialVersion, true, nil
}

func Bump(root string, increments []Increment) (before, after string, err error) {
	before, _, err = Ensure(root)
	if err != nil {
		return "", "", err
	}
	parts, err := parse(before)
	if err != nil {
		return "", "", err
	}
	for _, increment := range increments {
		if increment.Amount < 1 || increment.Amount > 1000 {
			return "", "", errors.New("version increment amount must be between 1 and 1000")
		}
		index, ok := componentIndex(increment.Component)
		if !ok {
			return "", "", fmt.Errorf("unsupported version component %q", increment.Component)
		}
		parts[index] += increment.Amount
		for reset := index + 1; reset < len(parts); reset++ {
			parts[reset] = 0
		}
	}
	after = format(parts)
	if after == before {
		return before, after, nil
	}
	if err := write(filepath.Join(root, FileName), after); err != nil {
		return "", "", err
	}
	return before, after, nil
}

func Restore(root, expectedCurrent, value string) error {
	path := filepath.Join(root, FileName)
	raw, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read %s before restore: %w", FileName, err)
	}
	current := strings.TrimSpace(string(raw))
	if current == strings.TrimSpace(value) {
		return nil
	}
	if expectedCurrent != "" && current != expectedCurrent {
		return fmt.Errorf("%s changed after apply: current %s, expected %s", FileName, current, expectedCurrent)
	}
	if _, err := parse(value); err != nil {
		return err
	}
	return write(path, value)
}

func parse(value string) ([4]int, error) {
	var out [4]int
	trimmed := strings.TrimSpace(value)
	trimmed = strings.TrimPrefix(trimmed, "v")
	fields := strings.Split(trimmed, ".")
	if len(fields) < 1 || len(fields) > 4 {
		return out, fmt.Errorf("%s must contain one to four numeric components", FileName)
	}
	for index, field := range fields {
		if field == "" {
			return out, fmt.Errorf("%s contains an empty component", FileName)
		}
		parsed, err := strconv.Atoi(field)
		if err != nil || parsed < 0 {
			return out, fmt.Errorf("%s must contain non-negative numeric components", FileName)
		}
		out[index] = parsed
	}
	return out, nil
}

func componentIndex(component string) (int, bool) {
	switch component {
	case "major":
		return 0, true
	case "medium":
		return 1, true
	case "minor":
		return 2, true
	case "patch":
		return 3, true
	default:
		return 0, false
	}
}

func format(parts [4]int) string {
	return fmt.Sprintf("v%d.%d.%d.%d", parts[0], parts[1], parts[2], parts[3])
}

func write(path, value string) error {
	root := filepath.Dir(path)
	tmp, err := os.CreateTemp(root, ".version-*.tmp")
	if err != nil {
		return fmt.Errorf("create temporary %s: %w", FileName, err)
	}
	name := tmp.Name()
	defer os.Remove(name)
	if err := tmp.Chmod(0o644); err != nil {
		tmp.Close()
		return err
	}
	if _, err := tmp.WriteString(strings.TrimSpace(value) + "\n"); err != nil {
		tmp.Close()
		return fmt.Errorf("write %s: %w", FileName, err)
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Rename(name, path); err != nil {
		return fmt.Errorf("install %s: %w", FileName, err)
	}
	return nil
}
