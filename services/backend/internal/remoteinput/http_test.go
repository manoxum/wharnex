package remoteinput

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestHTTPProviderPublishesAndDeletesObject(t *testing.T) {
	t.Helper()
	var uploaded []byte
	var deleted string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer secret" {
			t.Errorf("authorization header missing")
		}
		switch r.Method {
		case http.MethodPut:
			uploaded, _ = io.ReadAll(r.Body)
			w.WriteHeader(http.StatusCreated)
		case http.MethodDelete:
			deleted = r.URL.Path
			w.WriteHeader(http.StatusNoContent)
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	}))
	defer server.Close()

	provider, err := NewHTTPProvider(HTTPConfig{UploadBaseURL: server.URL + "/private", PublicBaseURL: "https://files.example.test/input", Authorization: "Bearer secret"})
	if err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(t.TempDir(), "input.zip")
	if err := os.WriteFile(file, []byte("zip-bytes"), 0o600); err != nil {
		t.Fatal(err)
	}
	publication, err := provider.Put(context.Background(), "wharness-input-req.zip", file)
	if err != nil {
		t.Fatal(err)
	}
	if string(uploaded) != "zip-bytes" || publication.URL != "https://files.example.test/input/wharness-input-req.zip" {
		t.Fatalf("unexpected publication: %#v bytes=%q", publication, uploaded)
	}
	if err := provider.Delete(context.Background(), "wharness-input-req.zip"); err != nil {
		t.Fatal(err)
	}
	if deleted != "/private/wharness-input-req.zip" {
		t.Fatalf("unexpected deleted path %q", deleted)
	}
}

func TestHTTPProviderRequiresHTTPSPublicURL(t *testing.T) {
	if _, err := NewHTTPProvider(HTTPConfig{UploadBaseURL: "http://127.0.0.1/upload", PublicBaseURL: "http://public.example/input"}); err == nil {
		t.Fatal("expected insecure public URL to be rejected")
	}
}

func TestPublishedRcloneURLAllowsShortLivedSignatureQuery(t *testing.T) {
	parsed, err := parsePublishedURL("https://files.example/input.zip?signature=short-lived")
	if err != nil || parsed.RawQuery == "" {
		t.Fatalf("expected signed HTTPS URL, got %#v err=%v", parsed, err)
	}
}
