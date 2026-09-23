package config

import (
	"path/filepath"
	"testing"
)

func TestUIPreferencesDefaultAndRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "ui-preferences.json")
	defaults, err := ReadUIPreferences(path)
	if err != nil {
		t.Fatal(err)
	}
	if defaults.Theme != "original" || defaults.Accent != "brand" || defaults.Scale != 1 {
		t.Fatalf("unexpected defaults: %+v", defaults)
	}

	want := defaults
	want.Theme = "vscode-dark"
	want.ResolvedTheme = "dark"
	want.Accent = "cyan"
	want.Density = "compact"
	want.Scale = 1.15
	if err := SaveUIPreferences(path, want); err != nil {
		t.Fatal(err)
	}
	got, err := ReadUIPreferences(path)
	if err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("round trip mismatch: got %+v want %+v", got, want)
	}
}

func TestUIPreferencesRejectInvalidValues(t *testing.T) {
	value := DefaultUIPreferences()
	value.Theme = "neon-hacker"
	if err := ValidateUIPreferences(value); err == nil {
		t.Fatal("expected unsupported theme to be rejected")
	}

	value = DefaultUIPreferences()
	value.ResolvedTheme = "sepia"
	if err := ValidateUIPreferences(value); err == nil {
		t.Fatal("expected unsupported resolved theme to be rejected")
	}

	value = DefaultUIPreferences()
	value.Scale = 2
	if err := ValidateUIPreferences(value); err == nil {
		t.Fatal("expected unsupported scale to be rejected")
	}
}
