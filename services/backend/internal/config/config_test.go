package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDependencyCacheDefaultsBesideSessionState(t *testing.T) {
	stateFile := filepath.Join(t.TempDir(), "state", "sessions.json")
	t.Setenv("HARNESS_STATE_FILE", stateFile)
	t.Setenv("HARNESS_DEPENDENCY_CACHE_DIR", "")
	cfg := Load()
	if cfg.DependencyCacheDir != filepath.Join(filepath.Dir(stateFile), "dependency-cache") {
		t.Fatalf("dependency cache dir = %q", cfg.DependencyCacheDir)
	}
}

func TestLoadRemoteStorageInstancesAllowsSeveralAccountsOfSameProvider(t *testing.T) {
	t.Setenv("WHARNESS_TEST_REMOTE_AUTH", "Bearer private")
	file := filepath.Join(t.TempDir(), "remote-storage.json")
	raw := []byte(`{
  "version": 1,
  "instances": [
    {"id":"webdav-primary","provider":"webdav","priority":10,"upload_url":"https://upload-one.example/","public_url":"https://files-one.example/","authorization_env":"WHARNESS_TEST_REMOTE_AUTH","limits":{"max_requests":20,"window_seconds":3600,"max_files_per_input":40}},
    {"id":"webdav-secondary","provider":"webdav","priority":20,"upload_url":"https://upload-two.example/","public_url":"https://files-two.example/","limits":{"max_storage_bytes":1000000}}
  ]
}`)
	if err := os.WriteFile(file, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	instances, err := LoadRemoteStorageInstances(RemoteStorageConfig{ConfigFile: file})
	if err != nil {
		t.Fatal(err)
	}
	if len(instances) != 2 || instances[0].Provider != instances[1].Provider || instances[0].Authorization != "Bearer private" {
		t.Fatalf("unexpected instances: %#v", instances)
	}
}

func TestLoadRemoteStorageInstancesRejectsDuplicateIdentityAndInvalidWindow(t *testing.T) {
	file := filepath.Join(t.TempDir(), "remote-storage.json")
	if err := os.WriteFile(file, []byte(`{"version":1,"instances":[{"id":"same","provider":"rclone","priority":1,"rclone_remote":"one","limits":{"max_requests":2}},{"id":"same","provider":"rclone","priority":2,"rclone_remote":"two"}]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadRemoteStorageInstances(RemoteStorageConfig{ConfigFile: file}); err == nil {
		t.Fatal("expected invalid per-instance configuration to be rejected")
	}
}

func TestSaveRemoteStorageDocumentRoundTripsWithoutSecrets(t *testing.T) {
	file := filepath.Join(t.TempDir(), "state", "remote-storage.json")
	cfg := RemoteStorageConfig{ConfigFile: file}
	document := RemoteStorageDocument{Version: 1, Instances: []RemoteStorageInstanceConfig{{
		ID: "drive-primary", Provider: "rclone", Priority: 10, RcloneRemote: "drive-main", RclonePrefix: "wharness",
	}}}
	if err := SaveRemoteStorageDocument(cfg, document); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(file)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("config permissions = %o, want 600", info.Mode().Perm())
	}
	loaded, err := ReadRemoteStorageDocument(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if len(loaded.Instances) != 1 || loaded.Instances[0].RcloneRemote != "drive-main" {
		t.Fatalf("unexpected document: %#v", loaded)
	}
}

func TestReadRemoteStorageDocumentReturnsEmptyDefault(t *testing.T) {
	document, err := ReadRemoteStorageDocument(RemoteStorageConfig{ConfigFile: filepath.Join(t.TempDir(), "missing.json")})
	if err != nil {
		t.Fatal(err)
	}
	if document.Version != 1 || document.Instances == nil || len(document.Instances) != 0 {
		t.Fatalf("unexpected default document: %#v", document)
	}
}

func TestSaveRemoteStorageDocumentRejectsInsecurePublicURL(t *testing.T) {
	document := RemoteStorageDocument{Version: 1, Instances: []RemoteStorageInstanceConfig{{
		ID: "private-http", Provider: "http", Priority: 10,
		UploadURL: "https://upload.example/files", PublicURL: "http://files.example/files",
	}}}
	if err := SaveRemoteStorageDocument(RemoteStorageConfig{ConfigFile: filepath.Join(t.TempDir(), "remote-storage.json")}, document); err == nil {
		t.Fatal("expected insecure public URL to be rejected")
	}
}

func TestSaveRemoteStorageDocumentAcceptsTryCloudflareWithoutRemoteCredentials(t *testing.T) {
	document := RemoteStorageDocument{Version: 1, Instances: []RemoteStorageInstanceConfig{{
		ID: "tunnel", Provider: "trycloudflare", Priority: 10,
	}}}
	if err := SaveRemoteStorageDocument(RemoteStorageConfig{ConfigFile: filepath.Join(t.TempDir(), "remote-storage.json")}, document); err != nil {
		t.Fatalf("TryCloudflare should not require a remote or credentials: %v", err)
	}
}
