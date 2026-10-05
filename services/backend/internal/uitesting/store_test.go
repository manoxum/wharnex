package uitesting

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestStoreEncryptsCredentialsAndKeepsThemOutOfDocument(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	project := "/workspace/demo"
	_, err = store.SaveDiscovery(project, Discovery{ContextSHA256: "ctx", Environments: []Environment{{
		ID: "admin", Name: "Admin", Profiles: []Profile{{ID: "administrator", Label: "Administrador", Role: "admin"}},
	}}})
	if err != nil {
		t.Fatal(err)
	}
	doc, err := store.Configure(project, "admin", "administrator", "https://admin.example.test", "alice@example.test", "correct-horse")
	if err != nil {
		t.Fatal(err)
	}
	if !doc.Environments[0].Profiles[0].Configured {
		t.Fatal("profile should be marked configured without exposing its secret")
	}
	credentials, err := store.Credentials(project, "admin", "administrator")
	if err != nil || credentials.Username != "alice@example.test" || credentials.Password != "correct-horse" {
		t.Fatalf("credentials=%#v err=%v", credentials, err)
	}
	raw, err := os.ReadFile(filepath.Join(store.dir, projectKey(project)+".json"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "alice@example.test") || strings.Contains(string(raw), "correct-horse") {
		t.Fatal("credential plaintext must never be persisted")
	}
}

func TestStoreAllowsURLOnlyEnvironmentConfiguration(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	project := "/workspace/public"
	if _, err := store.SaveDiscovery(project, Discovery{Environments: []Environment{{ID: "site", Name: "Site"}}}); err != nil {
		t.Fatal(err)
	}
	doc, err := store.Configure(project, "site", "", "https://site.example.test", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if doc.Environments[0].URL != "https://site.example.test" {
		t.Fatalf("url=%q", doc.Environments[0].URL)
	}
}

func TestStoreRejectsPartialCredentialUpdatesAndUnsafeAssetPaths(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	project := "/workspace/safe"
	if _, err := store.SaveDiscovery(project, Discovery{Environments: []Environment{{ID: "admin", Name: "Admin", Profiles: []Profile{{ID: "operator", Label: "Operador"}}}}}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Configure(project, "admin", "operator", "https://admin.example.test", "alice", "secret"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Configure(project, "admin", "operator", "https://admin2.example.test", "new-user", ""); err == nil {
		t.Fatal("partial credential updates must be rejected")
	}
	credentials, err := store.Credentials(project, "admin", "operator")
	if err != nil || credentials.Username != "alice" || credentials.Password != "secret" {
		t.Fatalf("credentials changed after rejected update: %#v err=%v", credentials, err)
	}
	for _, runID := range []string{"..", "../secret", "nested/run"} {
		if _, err := store.AssetPath(project, runID, "guide.pdf"); err == nil {
			t.Fatalf("unsafe run id %q must be rejected", runID)
		}
	}
	if err := writeAsset(t.TempDir(), "..", ""); err == nil {
		t.Fatal("unsafe asset name must be rejected")
	}
}

func TestEnvironmentNotesAreLocalAndSurviveSynchronization(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	project := "/workspace/notes"
	if _, err := store.SaveDiscovery(project, Discovery{Origin: DiscoveryOriginSync, Environments: []Environment{{ID: "site", Name: "Site", Notes: "from GPT"}}}); err != nil {
		t.Fatal(err)
	}
	doc, _ := store.Load(project)
	if doc.Environments[0].Notes != "" {
		t.Fatal("GPT must not author local notes")
	}
	if _, err := store.SetNotes(project, "site", "Documento emitido: EM-1"); err != nil {
		t.Fatal(err)
	}
	doc, err = store.SaveDiscovery(project, Discovery{Origin: DiscoveryOriginSync, Environments: []Environment{{ID: "site", Name: "Site novo", Notes: "overwrite"}}})
	if err != nil || doc.Environments[0].Notes != "Documento emitido: EM-1" || doc.Environments[0].Name != "Site novo" {
		t.Fatalf("notes=%q err=%v", doc.Environments[0].Notes, err)
	}
	if _, err := store.SetNotes(project, "site", strings.Repeat("x", MaxEnvironmentNotes+1)); err == nil {
		t.Fatal("oversized notes accepted")
	}
}
