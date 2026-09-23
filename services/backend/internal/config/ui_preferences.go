package config

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

type UIPreferencesDocument struct {
	UIFont                   string  `json:"uiFont"`
	MonoFont                 string  `json:"monoFont"`
	Scale                    float64 `json:"scale"`
	Theme                    string  `json:"theme"`
	ResolvedTheme            string  `json:"resolvedTheme,omitempty"`
	Accent                   string  `json:"accent"`
	ContentScheme            string  `json:"contentScheme"`
	Density                  string  `json:"density"`
	ToolRailPlacement        string  `json:"toolRailPlacement"`
	ErrorPopups              bool    `json:"errorPopups"`
	LargePasteThresholdChars int     `json:"largePasteThresholdChars"`
}

func DefaultUIPreferences() UIPreferencesDocument {
	return UIPreferencesDocument{
		UIFont: "elegant", MonoFont: "jetbrains", Scale: 1, Theme: "original", Accent: "brand",
		ContentScheme: "follow-ui", Density: "default", ToolRailPlacement: "sides", ErrorPopups: true,
		LargePasteThresholdChars: 6000,
	}
}

func ReadUIPreferences(path string) (UIPreferencesDocument, error) {
	defaults := DefaultUIPreferences()
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) || path == "" {
		return defaults, nil
	}
	if err != nil {
		return UIPreferencesDocument{}, fmt.Errorf("read ui preferences: %w", err)
	}
	var document UIPreferencesDocument
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&document); err != nil {
		return UIPreferencesDocument{}, fmt.Errorf("decode ui preferences: %w", err)
	}
	if err := ValidateUIPreferences(document); err != nil {
		return UIPreferencesDocument{}, err
	}
	return document, nil
}

func SaveUIPreferences(path string, document UIPreferencesDocument) error {
	if err := ValidateUIPreferences(document); err != nil {
		return err
	}
	if path == "" {
		return errors.New("ui preferences file is not configured")
	}
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("create ui preferences directory: %w", err)
	}
	tmp, err := os.CreateTemp(dir, ".ui-preferences-*.json")
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

func ValidateUIPreferences(value UIPreferencesDocument) error {
	if !oneOf(value.UIFont, "elegant", "system", "humanist") || !oneOf(value.MonoFont, "jetbrains", "system", "fira") {
		return errors.New("ui preferences contain an unsupported font")
	}
	if value.Scale < 0.4 || value.Scale > 1.6 {
		return errors.New("ui preferences scale must be between 0.4 and 1.6")
	}
	if !oneOf(value.Theme, "original", "jetbrains-darcula", "jetbrains-light", "vscode-dark", "vscode-light", "high-contrast") {
		return errors.New("ui preferences contain an unsupported theme")
	}
	if value.ResolvedTheme != "" && !oneOf(value.ResolvedTheme, "light", "dark") {
		return errors.New("ui preferences contain an unsupported resolved theme")
	}
	if !oneOf(value.Accent, "brand", "blue", "violet", "orange", "rose", "cyan") || !oneOf(value.ContentScheme, "follow-ui", "original", "light", "dark", "high-contrast") {
		return errors.New("ui preferences contain an unsupported appearance option")
	}
	if !oneOf(value.Density, "default", "compact") || !oneOf(value.ToolRailPlacement, "sides", "bottom") {
		return errors.New("ui preferences contain an unsupported layout option")
	}
	if value.LargePasteThresholdChars < 1000 || value.LargePasteThresholdChars > 200000 {
		return errors.New("large paste threshold must be between 1000 and 200000")
	}
	return nil
}

func oneOf(value string, options ...string) bool {
	for _, option := range options {
		if value == option {
			return true
		}
	}
	return false
}
