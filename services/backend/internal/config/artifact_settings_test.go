package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestReadArtifactSettingsUpgradesLegacyDocumentWithBundleLimit(t *testing.T) {
	file := filepath.Join(t.TempDir(), "artifact-storage.json")
	if err := os.WriteFile(file, []byte(`{"version":1,"retention_days":30}`), 0o600); err != nil {
		t.Fatal(err)
	}
	document, err := ReadArtifactSettings(ArtifactStorageConfig{SettingsFile: file})
	if err != nil {
		t.Fatal(err)
	}
	if document.RetentionDays != 30 || document.BundleWindowLimit != 80 || document.AttachmentCountLimit != 0 ||
		document.RequestBundleTotalBytes != 100<<20 || document.RequestBundlePartBytes != 30<<20 || document.RequestBundlePartLimit != 10 {
		t.Fatalf("unexpected upgraded settings: %#v", document)
	}
}

func TestSaveArtifactSettingsPersistsBundleLimit(t *testing.T) {
	file := filepath.Join(t.TempDir(), "state", "artifact-storage.json")
	cfg := ArtifactStorageConfig{SettingsFile: file}
	want := ArtifactSettingsDocument{
		Version: 1, RetentionDays: 45, BundleWindowLimit: 96, AttachmentCountLimit: 25,
		RequestBundleTotalBytes: 180 << 20, RequestBundlePartBytes: 40 << 20, RequestBundlePartLimit: 7,
	}
	if err := SaveArtifactSettings(cfg, want); err != nil {
		t.Fatal(err)
	}
	got, err := ReadArtifactSettings(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("round trip = %#v, want %#v", got, want)
	}
}
