package projectconfig

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

const (
	FileName           = "whaness.yml"
	CurrentVersion     = 1
	DefaultMaxFileSize = int64(2 * 1024 * 1024)
	MaxConfiguredSize  = int64(64 * 1024 * 1024)
)

type Config struct {
	Version int           `json:"version"`
	Project ProjectConfig `json:"project"`
	Context ContextConfig `json:"context"`
}

type ProjectConfig struct {
	Name string `json:"name"`
}

type ContextConfig struct {
	AutoExclude     bool     `json:"auto_exclude"`
	MaxFileBytes    int64    `json:"max_file_bytes"`
	Include         []string `json:"include"`
	IncludeOverride []string `json:"include_overrides"`
	Exclude         []string `json:"exclude"`
}

func Default(root string) Config {
	return Config{
		Version: CurrentVersion,
		Project: ProjectConfig{Name: filepath.Base(filepath.Clean(root))},
		Context: ContextConfig{
			AutoExclude:     true,
			MaxFileBytes:    DefaultMaxFileSize,
			Include:         []string{},
			IncludeOverride: []string{},
			Exclude:         []string{},
		},
	}
}

func Ensure(root string) (Config, bool, error) {
	filename := filepath.Join(root, FileName)
	if _, err := os.Stat(filename); err == nil {
		cfg, err := Load(root)
		return cfg, false, err
	} else if !os.IsNotExist(err) {
		return Config{}, false, fmt.Errorf("inspect %s: %w", FileName, err)
	}
	cfg := Default(root)
	if err := Save(root, cfg); err != nil {
		return Config{}, false, err
	}
	return cfg, true, nil
}

func Load(root string) (Config, error) {
	file, err := os.Open(filepath.Join(root, FileName))
	if err != nil {
		return Config{}, fmt.Errorf("open %s: %w", FileName, err)
	}
	defer file.Close()

	cfg := Default(root)
	section, listKey := "", ""
	scanner := bufio.NewScanner(file)
	for lineNo := 1; scanner.Scan(); lineNo++ {
		raw := scanner.Text()
		trimmed := strings.TrimSpace(raw)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}
		indent := len(raw) - len(strings.TrimLeft(raw, " \t"))
		if strings.HasPrefix(trimmed, "- ") {
			if section != "context" || listKey == "" {
				return Config{}, fmt.Errorf("%s:%d: list item outside context include/exclude", FileName, lineNo)
			}
			value, err := parseScalar(strings.TrimSpace(strings.TrimPrefix(trimmed, "- ")))
			if err != nil {
				return Config{}, fmt.Errorf("%s:%d: %w", FileName, lineNo, err)
			}
			if listKey == "include" {
				cfg.Context.Include = append(cfg.Context.Include, value)
			} else if listKey == "include_overrides" {
				cfg.Context.IncludeOverride = append(cfg.Context.IncludeOverride, value)
			} else {
				cfg.Context.Exclude = append(cfg.Context.Exclude, value)
			}
			continue
		}
		key, value, ok := strings.Cut(trimmed, ":")
		if !ok {
			return Config{}, fmt.Errorf("%s:%d: expected key: value", FileName, lineNo)
		}
		key, value = strings.TrimSpace(key), strings.TrimSpace(value)
		if indent == 0 {
			listKey = ""
			switch key {
			case "version":
				parsed, err := strconv.Atoi(value)
				if err != nil {
					return Config{}, fmt.Errorf("%s:%d: invalid version", FileName, lineNo)
				}
				cfg.Version = parsed
				section = ""
			case "project", "context":
				if value != "" {
					return Config{}, fmt.Errorf("%s:%d: section %s must not have an inline value", FileName, lineNo, key)
				}
				section = key
			default:
				section = ""
			}
			continue
		}
		if section == "project" && key == "name" {
			cfg.Project.Name, err = parseScalar(value)
			if err != nil {
				return Config{}, fmt.Errorf("%s:%d: %w", FileName, lineNo, err)
			}
			continue
		}
		if section != "context" {
			continue
		}
		switch key {
		case "auto_exclude":
			parsed, err := strconv.ParseBool(value)
			if err != nil {
				return Config{}, fmt.Errorf("%s:%d: invalid auto_exclude", FileName, lineNo)
			}
			cfg.Context.AutoExclude = parsed
			listKey = ""
		case "max_file_bytes":
			parsed, err := strconv.ParseInt(value, 10, 64)
			if err != nil {
				return Config{}, fmt.Errorf("%s:%d: invalid max_file_bytes", FileName, lineNo)
			}
			cfg.Context.MaxFileBytes = parsed
			listKey = ""
		case "include", "include_overrides", "exclude":
			if value != "" && value != "[]" {
				return Config{}, fmt.Errorf("%s:%d: %s must be a YAML list", FileName, lineNo, key)
			}
			if key == "include" {
				cfg.Context.Include = []string{}
			} else if key == "include_overrides" {
				cfg.Context.IncludeOverride = []string{}
			} else {
				cfg.Context.Exclude = []string{}
			}
			listKey = key
		}
	}
	if err := scanner.Err(); err != nil {
		return Config{}, fmt.Errorf("read %s: %w", FileName, err)
	}
	if err := Validate(&cfg); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

func Save(root string, cfg Config) error {
	if err := Validate(&cfg); err != nil {
		return err
	}
	data := []byte(render(cfg))
	filename := filepath.Join(root, FileName)
	tmp, err := os.CreateTemp(root, ".whaness-*.tmp")
	if err != nil {
		return fmt.Errorf("create temporary %s: %w", FileName, err)
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	if err := tmp.Chmod(0o644); err != nil {
		tmp.Close()
		return err
	}
	if _, err := tmp.Write(data); err != nil {
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
	if err := os.Rename(tmpName, filename); err != nil {
		return fmt.Errorf("install %s: %w", FileName, err)
	}
	return nil
}
