package artifactstore

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestMinIOUsesSignedS3Requests(t *testing.T) {
	var methods []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		methods = append(methods, r.Method+" "+r.URL.Path)
		if !strings.HasPrefix(r.Header.Get("Authorization"), "AWS4-HMAC-SHA256 Credential=access/") {
			t.Fatalf("request is not signed: %q", r.Header.Get("Authorization"))
		}
		switch r.Method {
		case http.MethodGet:
			w.Header().Set("Content-Type", "application/zip")
			_, _ = io.WriteString(w, "stored")
		case http.MethodDelete:
			w.WriteHeader(http.StatusNoContent)
		default:
			w.WriteHeader(http.StatusOK)
		}
	}))
	defer server.Close()

	store, err := NewMinIO(Config{Endpoint: server.URL, AccessKey: "access", SecretKey: "secret", Bucket: "artifacts", Region: "us-east-1"})
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	if err := store.EnsureBucket(ctx); err != nil {
		t.Fatal(err)
	}
	if err := store.Put(ctx, "sessions/s1/a1", "application/zip", []byte("payload")); err != nil {
		t.Fatal(err)
	}
	raw, contentType, err := store.Get(ctx, "sessions/s1/a1")
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != "stored" || contentType != "application/zip" {
		t.Fatalf("unexpected get result: %q %q", raw, contentType)
	}
	if err := store.Delete(ctx, "sessions/s1/a1"); err != nil {
		t.Fatal(err)
	}
	want := []string{"PUT /artifacts", "PUT /artifacts/sessions/s1/a1", "GET /artifacts/sessions/s1/a1", "DELETE /artifacts/sessions/s1/a1"}
	if strings.Join(methods, "|") != strings.Join(want, "|") {
		t.Fatalf("unexpected requests: %#v", methods)
	}
}
