package config

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

type LanguageSettingsDocument struct {
	Version              int      `json:"version"`
	InterfaceLanguage    string   `json:"interface_language"`
	TranslationLanguages []string `json:"translation_languages"`
}

func DefaultLanguageSettings() LanguageSettingsDocument {
	return LanguageSettingsDocument{Version: 1, InterfaceLanguage: "pt", TranslationLanguages: []string{"pt", "en", "fr"}}
}

func ReadLanguageSettings(path string) (LanguageSettingsDocument, error) {
	defaults := DefaultLanguageSettings()
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return defaults, nil
	}
	if err != nil {
		return LanguageSettingsDocument{}, fmt.Errorf("read language settings: %w", err)
	}
	var document LanguageSettingsDocument
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&document); err != nil {
		return LanguageSettingsDocument{}, fmt.Errorf("decode language settings: %w", err)
	}
	if err := ValidateLanguageSettings(document); err != nil {
		return LanguageSettingsDocument{}, err
	}
	return document, nil
}

func SaveLanguageSettings(path string, document LanguageSettingsDocument) error {
	if err := ValidateLanguageSettings(document); err != nil {
		return err
	}
	if path == "" {
		return errors.New("language settings file is not configured")
	}
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("create language settings directory: %w", err)
	}
	tmp, err := os.CreateTemp(dir, ".language-settings-*.json")
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

func ValidateLanguageSettings(document LanguageSettingsDocument) error {
	if document.Version != 1 || !SupportedLanguageCode(document.InterfaceLanguage) {
		return errors.New("language settings require version 1 and interface_language pt, en, or fr")
	}
	if len(document.TranslationLanguages) < 1 || len(document.TranslationLanguages) > 3 {
		return errors.New("translation_languages must contain one to three supported languages")
	}
	seen := make(map[string]struct{}, len(document.TranslationLanguages))
	for _, language := range document.TranslationLanguages {
		if !SupportedLanguageCode(language) {
			return fmt.Errorf("unsupported translation language %q", language)
		}
		if _, exists := seen[language]; exists {
			return fmt.Errorf("duplicate translation language %q", language)
		}
		seen[language] = struct{}{}
	}
	return nil
}

func SupportedLanguageCode(language string) bool {
	switch language {
	case "pt", "en", "fr":
		return true
	default:
		return false
	}
}
