package config

import (
	"path/filepath"
	"reflect"
	"testing"
)

func TestLanguageSettingsDefaultAndRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "language-settings.json")
	defaults, err := ReadLanguageSettings(path)
	if err != nil {
		t.Fatal(err)
	}
	if defaults.InterfaceLanguage != "pt" || !reflect.DeepEqual(defaults.TranslationLanguages, []string{"pt", "en", "fr"}) {
		t.Fatalf("unexpected defaults: %#v", defaults)
	}
	want := LanguageSettingsDocument{Version: 1, InterfaceLanguage: "fr", TranslationLanguages: []string{"en", "pt"}}
	if err := SaveLanguageSettings(path, want); err != nil {
		t.Fatal(err)
	}
	got, err := ReadLanguageSettings(path)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %#v want %#v", got, want)
	}
}

func TestLanguageSettingsRejectsUnsupportedAndDuplicateTargets(t *testing.T) {
	for _, document := range []LanguageSettingsDocument{
		{Version: 1, InterfaceLanguage: "de", TranslationLanguages: []string{"en"}},
		{Version: 1, InterfaceLanguage: "pt", TranslationLanguages: []string{"en", "en"}},
		{Version: 1, InterfaceLanguage: "pt", TranslationLanguages: nil},
	} {
		if err := ValidateLanguageSettings(document); err == nil {
			t.Fatalf("expected validation error for %#v", document)
		}
	}
}
