package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestExecutionSettingsDefaultAndRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state", "execution-settings.json")
	defaults, err := ReadExecutionSettings(path, 3)
	if err != nil {
		t.Fatal(err)
	}
	if defaults.ProjectConcurrency != 3 {
		t.Fatalf("default project concurrency = %d, want 3", defaults.ProjectConcurrency)
	}

	want := ExecutionSettingsDocument{Version: 1, ProjectConcurrency: 4}
	if err := SaveExecutionSettings(path, want); err != nil {
		t.Fatal(err)
	}
	got, err := ReadExecutionSettings(path, 1)
	if err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("execution settings = %#v, want %#v", got, want)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("execution settings permissions = %o, want 600", info.Mode().Perm())
	}
}

func TestExecutionSettingsRejectInvalidConcurrency(t *testing.T) {
	path := filepath.Join(t.TempDir(), "execution-settings.json")
	if err := SaveExecutionSettings(path, ExecutionSettingsDocument{Version: 1, ProjectConcurrency: 9}); err == nil {
		t.Fatal("expected concurrency above the bounded ceiling to be rejected")
	}
	if err := os.WriteFile(path, []byte(`{"version":1,"project_execution_concurrency":0}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := ReadExecutionSettings(path, 1); err == nil {
		t.Fatal("expected an invalid persisted concurrency to be rejected")
	}
}
