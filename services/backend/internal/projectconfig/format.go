package projectconfig

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
)

func Validate(cfg *Config) error {
	if cfg == nil {
		return errors.New("project config is required")
	}
	if cfg.Version == 0 {
		cfg.Version = CurrentVersion
	}
	if cfg.Version != CurrentVersion {
		return fmt.Errorf("unsupported %s version %d", FileName, cfg.Version)
	}
	cfg.Project.Name = strings.TrimSpace(cfg.Project.Name)
	if cfg.Context.MaxFileBytes == 0 {
		cfg.Context.MaxFileBytes = DefaultMaxFileSize
	}
	if cfg.Context.MaxFileBytes < 1024 || cfg.Context.MaxFileBytes > MaxConfiguredSize {
		return fmt.Errorf("context.max_file_bytes must be between 1024 and %d", MaxConfiguredSize)
	}
	var err error
	cfg.Context.Include, err = normalizePatterns(cfg.Context.Include)
	if err != nil {
		return fmt.Errorf("context.include: %w", err)
	}
	cfg.Context.Exclude, err = normalizePatterns(cfg.Context.Exclude)
	if err != nil {
		return fmt.Errorf("context.exclude: %w", err)
	}
	return nil
}

func normalizePatterns(values []string) ([]string, error) {
	if len(values) > 200 {
		return nil, errors.New("at most 200 patterns are allowed")
	}
	seen := make(map[string]bool, len(values))
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(strings.ReplaceAll(value, "\\", "/"))
		value = strings.TrimPrefix(value, "./")
		if value == "" {
			continue
		}
		if strings.HasPrefix(value, "/") || hasParentSegment(value) || strings.ContainsRune(value, '\x00') {
			return nil, fmt.Errorf("pattern %q must stay relative to the project", value)
		}
		if !seen[value] {
			seen[value] = true
			out = append(out, value)
		}
	}
	return out, nil
}

func hasParentSegment(value string) bool {
	for _, segment := range strings.Split(value, "/") {
		if segment == ".." {
			return true
		}
	}
	return false
}

func parseScalar(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", nil
	}
	if value[0] == '"' {
		parsed, err := strconv.Unquote(value)
		if err != nil {
			return "", errors.New("invalid quoted string")
		}
		return parsed, nil
	}
	return value, nil
}

func render(cfg Config) string {
	var b strings.Builder
	b.WriteString("# Wharnex project configuration. Managed by Wharnex; safe to edit.\n")
	b.WriteString("version: ")
	b.WriteString(strconv.Itoa(cfg.Version))
	b.WriteString("\nproject:\n  name: ")
	b.WriteString(strconv.Quote(cfg.Project.Name))
	b.WriteString("\ncontext:\n  auto_exclude: ")
	b.WriteString(strconv.FormatBool(cfg.Context.AutoExclude))
	b.WriteString("\n  max_file_bytes: ")
	b.WriteString(strconv.FormatInt(cfg.Context.MaxFileBytes, 10))
	if len(cfg.Context.Include) == 0 {
		b.WriteString("\n  include: []\n")
	} else {
		b.WriteString("\n  include:\n")
		for _, value := range cfg.Context.Include {
			b.WriteString("    - ")
			b.WriteString(strconv.Quote(value))
			b.WriteByte('\n')
		}
	}
	if len(cfg.Context.Exclude) == 0 {
		b.WriteString("  exclude: []\n")
	} else {
		b.WriteString("  exclude:\n")
		for _, value := range cfg.Context.Exclude {
			b.WriteString("    - ")
			b.WriteString(strconv.Quote(value))
			b.WriteByte('\n')
		}
	}
	return b.String()
}
