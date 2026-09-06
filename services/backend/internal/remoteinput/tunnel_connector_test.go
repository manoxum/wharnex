package remoteinput

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestTunnelConnectorStoresAccountTokenOnlyInPrivateCredentialFile(t *testing.T) {
	root := t.TempDir()
	connector := NewTunnelConnector(filepath.Join(root, "credentials"))
	token := "private-account-token"
	if err := connector.writeCredential("primary", tunnelCredential{Provider: "cloudflare_named", Token: token}); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, "credentials", "primary.json")
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("credential permissions = %o", info.Mode().Perm())
	}
	credential, err := readTunnelCredential(filepath.Dir(path), "primary", "cloudflare_named")
	if err != nil || credential.Token != token {
		t.Fatalf("credential round trip failed: %#v %v", credential, err)
	}
	if strings.Contains(path, token) {
		t.Fatal("credential leaked into its opaque reference")
	}
}
