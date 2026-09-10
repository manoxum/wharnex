// Package gitsettings persists how each project's Git surface behaves.
//
// It is a separate package rather than part of internal/config because
// internal/config already depends on internal/app, and the application layer
// has to read these settings on every Apply — importing config from app would
// close an import cycle.
package gitsettings

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// CommitMode decides what Wharnex does with the host's history once a
// verified change has been applied and re-verified.
type CommitMode string

const (
	// CommitModeAuto keeps the commits the integration merge creates, so
	// each applied change lands as real project history immediately. This is
	// the historical behavior and remains the default.
	CommitModeAuto CommitMode = "auto"
	// CommitModeManual returns the branch to where the operator left it
	// once verification passes, leaving the applied change — and the
	// operator's own prior edits — in the working tree as uncommitted work.
	// Wharnex still authors the commit message and records the change's diff,
	// so the operator commits deliberately rather than losing the message.
	CommitModeManual CommitMode = "manual"
)

// ValidCommitMode reports whether a mode is one Wharnex implements.
func ValidCommitMode(mode CommitMode) bool {
	return mode == CommitModeAuto || mode == CommitModeManual
}

// ProjectSettings is one project's Git surface configuration.
type ProjectSettings struct {
	CommitMode CommitMode `json:"commit_mode"`
}

// Document holds Git settings for every project, keyed by canonical
// project path.
//
// It lives in Wharnex's own state directory rather than in the project's
// `whaness.yml`, because it is operational configuration for how Wharnex
// behaves — not project content. Writing it into the repository would put a
// Wharnex preference into the operator's commits and, in manual mode, into the
// very diff the mode exists to keep clean.
type Document struct {
	Version  int                        `json:"version"`
	Projects map[string]ProjectSettings `json:"projects"`
}

// Default is an empty document; every project resolves to auto.
func Default() Document {
	return Document{Version: 1, Projects: map[string]ProjectSettings{}}
}

// DefaultProject is what a project with no stored entry uses.
// Auto-commit is the default deliberately: it is the behavior every existing
// project already has, so upgrading changes nothing until an operator chooses
// otherwise.
func DefaultProject() ProjectSettings {
	return ProjectSettings{CommitMode: CommitModeAuto}
}

// ForProject resolves one project's settings, falling back to the default.
func (d Document) ForProject(projectPath string) ProjectSettings {
	settings, ok := d.Projects[canonicalProjectKey(projectPath)]
	if !ok || !ValidCommitMode(settings.CommitMode) {
		return DefaultProject()
	}
	return settings
}

// WithProject returns a copy carrying one project's updated settings.
func (d Document) WithProject(projectPath string, settings ProjectSettings) Document {
	updated := Document{Version: 1, Projects: map[string]ProjectSettings{}}
	for key, value := range d.Projects {
		updated.Projects[key] = value
	}
	updated.Projects[canonicalProjectKey(projectPath)] = settings
	return updated
}

// canonicalProjectKey normalizes a project path so the same project resolves
// identically however the caller spelled it.
func canonicalProjectKey(projectPath string) string {
	trimmed := strings.TrimSpace(projectPath)
	if trimmed == "" {
		return ""
	}
	if abs, err := filepath.Abs(trimmed); err == nil {
		return filepath.Clean(abs)
	}
	return filepath.Clean(trimmed)
}

// Read loads the document, returning defaults when absent.
func Read(path string) (Document, error) {
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return Default(), nil
	}
	if err != nil {
		return Document{}, fmt.Errorf("read git settings: %w", err)
	}
	var document Document
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&document); err != nil {
		return Document{}, fmt.Errorf("decode git settings: %w", err)
	}
	if document.Version != 1 {
		return Document{}, errors.New("git settings require version 1")
	}
	if document.Projects == nil {
		document.Projects = map[string]ProjectSettings{}
	}
	for project, settings := range document.Projects {
		if !ValidCommitMode(settings.CommitMode) {
			return Document{}, fmt.Errorf("unsupported commit_mode %q for %s", settings.CommitMode, project)
		}
	}
	return document, nil
}

// Save writes the document atomically.
func Save(path string, document Document) error {
	if strings.TrimSpace(path) == "" {
		return errors.New("git settings file is not configured")
	}
	if document.Version != 1 {
		return errors.New("git settings require version 1")
	}
	for project, settings := range document.Projects {
		if !ValidCommitMode(settings.CommitMode) {
			return fmt.Errorf("unsupported commit_mode %q for %s", settings.CommitMode, project)
		}
	}
	return writeJSONAtomic(path, ".git-settings-*.json", document)
}

// writeJSONAtomic writes a document through a temporary file and one rename,
// so a crash mid-write can never leave a half-written settings document that
// fails to parse on the next start.
func writeJSONAtomic(path, pattern string, document any) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("create settings directory: %w", err)
	}
	tmp, err := os.CreateTemp(dir, pattern)
	if err != nil {
		return err
	}
	name := tmp.Name()
	defer os.Remove(name)
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		return err
	}
	encoder := json.NewEncoder(tmp)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(document); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(name, path)
}
