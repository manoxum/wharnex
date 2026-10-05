package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"kernl.local/harness/backend/internal/config"
)

func TestRemoteStorageConfigAPIReadsAndWritesDocument(t *testing.T) {
	file := filepath.Join(t.TempDir(), "remote-storage.json")
	handler := New(nil, nil, nil, config.Config{StateFile: filepath.Join(t.TempDir(), "state.json"), RemoteStorage: config.RemoteStorageConfig{ConfigFile: file}})
	body := []byte(`{"version":1,"instances":[{"id":"backup","provider":"rclone","priority":20,"rclone_remote":"backup"}]}`)

	put := httptest.NewRequest(http.MethodPut, "/api/remote-storage-config", bytes.NewReader(body))
	putResult := httptest.NewRecorder()
	handler.ServeHTTP(putResult, put)
	if putResult.Code != http.StatusOK {
		t.Fatalf("PUT status = %d: %s", putResult.Code, putResult.Body.String())
	}
	var saved struct {
		RestartRequired bool `json:"restart_required"`
	}
	if err := json.Unmarshal(putResult.Body.Bytes(), &saved); err != nil || !saved.RestartRequired {
		t.Fatalf("unexpected PUT response: %s", putResult.Body.String())
	}

	get := httptest.NewRequest(http.MethodGet, "/api/remote-storage-config", nil)
	getResult := httptest.NewRecorder()
	handler.ServeHTTP(getResult, get)
	if getResult.Code != http.StatusOK || !bytes.Contains(getResult.Body.Bytes(), []byte(`"id":"backup"`)) {
		t.Fatalf("unexpected GET response (%d): %s", getResult.Code, getResult.Body.String())
	}
}

func TestRemoteStorageConfigAPIRejectsUnknownFields(t *testing.T) {
	handler := New(nil, nil, nil, config.Config{StateFile: filepath.Join(t.TempDir(), "state.json"), RemoteStorage: config.RemoteStorageConfig{ConfigFile: filepath.Join(t.TempDir(), "remote-storage.json")}})
	request := httptest.NewRequest(http.MethodPut, "/api/remote-storage-config", bytes.NewBufferString(`{"version":1,"instances":[],"secret":"no"}`))
	result := httptest.NewRecorder()
	handler.ServeHTTP(result, request)
	if result.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", result.Code)
	}
}
