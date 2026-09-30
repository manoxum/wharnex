package settings

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"kernl.local/harness/backend/internal/config"
)

func TestLanguageSettingsRoutesPreserveStrictDocumentRoundTrip(t *testing.T) {
	routes := New(nil, config.Config{LanguageSettingsFile: filepath.Join(t.TempDir(), "language.json")})
	body := []byte(`{"version":1,"interface_language":"en","translation_languages":["en","pt"]}`)
	request := httptest.NewRequest(http.MethodPut, "/api/language-settings", bytes.NewReader(body))
	result := httptest.NewRecorder()
	routes.UpdateLanguageSettings(result, request)
	if result.Code != http.StatusOK {
		t.Fatalf("PUT status %d: %s", result.Code, result.Body.String())
	}
	read := httptest.NewRecorder()
	routes.LanguageSettings(read, httptest.NewRequest(http.MethodGet, "/api/language-settings", nil))
	var saved config.LanguageSettingsDocument
	if err := json.Unmarshal(read.Body.Bytes(), &saved); err != nil || saved.InterfaceLanguage != "en" || len(saved.TranslationLanguages) != 2 {
		t.Fatalf("GET document = %#v, error = %v", saved, err)
	}
	invalid := httptest.NewRecorder()
	routes.UpdateLanguageSettings(invalid, httptest.NewRequest(http.MethodPut, "/api/language-settings", bytes.NewBufferString(`{"version":1,"interface_language":"pt","translation_languages":["pt"],"unknown":true}`)))
	if invalid.Code != http.StatusBadRequest {
		t.Fatalf("unknown field status %d: %s", invalid.Code, invalid.Body.String())
	}
}

func TestUIPreferencesRoutesPreserveDocument(t *testing.T) {
	routes := New(nil, config.Config{UIPreferencesFile: filepath.Join(t.TempDir(), "ui.json")})
	document := config.DefaultUIPreferences()
	document.Theme = "vscode-dark"
	body, err := json.Marshal(document)
	if err != nil {
		t.Fatal(err)
	}
	updated := httptest.NewRecorder()
	routes.UpdateUIPreferences(updated, httptest.NewRequest(http.MethodPut, "/api/ui-preferences", bytes.NewReader(body)))
	if updated.Code != http.StatusOK {
		t.Fatalf("PUT status %d: %s", updated.Code, updated.Body.String())
	}
	read := httptest.NewRecorder()
	routes.UIPreferences(read, httptest.NewRequest(http.MethodGet, "/api/ui-preferences", nil))
	var saved config.UIPreferencesDocument
	if err := json.Unmarshal(read.Body.Bytes(), &saved); err != nil || saved.Theme != document.Theme {
		t.Fatalf("GET document = %#v, error = %v", saved, err)
	}
}
