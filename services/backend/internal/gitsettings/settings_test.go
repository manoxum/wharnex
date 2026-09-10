package gitsettings

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDefaultsToAutoCommit(t *testing.T) {
	document, err := Read(filepath.Join(t.TempDir(), "git-settings.json"))
	if err != nil {
		t.Fatalf("an absent document must read as defaults, got %v", err)
	}
	// Auto is the behavior every existing project already has; shipping this
	// feature must not silently change what happens to anyone's history.
	if document.ForProject("/w/alpha").CommitMode != CommitModeAuto {
		t.Fatalf("expected auto by default, got %+v", document.ForProject("/w/alpha"))
	}
}

func TestRoundTripPerProject(t *testing.T) {
	path := filepath.Join(t.TempDir(), "git-settings.json")
	document := Default().
		WithProject("/w/alpha", ProjectSettings{CommitMode: CommitModeManual}).
		WithProject("/w/beta", ProjectSettings{CommitMode: CommitModeAuto})
	if err := Save(path, document); err != nil {
		t.Fatal(err)
	}
	reloaded, err := Read(path)
	if err != nil {
		t.Fatal(err)
	}
	if reloaded.ForProject("/w/alpha").CommitMode != CommitModeManual {
		t.Fatalf("expected manual preserved, got %+v", reloaded.ForProject("/w/alpha"))
	}
	if reloaded.ForProject("/w/beta").CommitMode != CommitModeAuto {
		t.Fatalf("expected auto preserved, got %+v", reloaded.ForProject("/w/beta"))
	}
	if reloaded.ForProject("/w/alpha/").CommitMode != CommitModeManual {
		t.Fatal("project keys must be canonical, so the same project resolves once")
	}
	info, statErr := os.Stat(path)
	if statErr != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("settings must be written 0600, got %v err=%v", info.Mode().Perm(), statErr)
	}
}

func TestRejectsAnUnsupportedMode(t *testing.T) {
	path := filepath.Join(t.TempDir(), "git-settings.json")
	invalid := Document{Version: 1, Projects: map[string]ProjectSettings{"/w/a": {CommitMode: "sometimes"}}}
	if err := Save(path, invalid); err == nil {
		t.Fatal("an unsupported commit mode must be refused")
	}
	if err := os.WriteFile(path, []byte(`{"version":1,"projects":{"/w/a":{"commit_mode":"sometimes"}}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Read(path); err == nil {
		t.Fatal("a stored unsupported mode must be refused on read, not silently coerced")
	}
}
