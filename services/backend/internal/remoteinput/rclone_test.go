package remoteinput

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
)

func TestNormalizeRclonePublishedURLConvertsGoogleDriveViewerToRawDownload(t *testing.T) {
	got, err := normalizeRclonePublishedURL("drive", "https://drive.google.com/open?id=1AbC_def-234")
	if err != nil {
		t.Fatal(err)
	}
	want := "https://drive.google.com/uc?export=download&id=1AbC_def-234&confirm=t"
	if got.String() != want {
		t.Fatalf("got %q, want %q", got.String(), want)
	}
}

func TestVerifyDirectZIPRejectsHTMLLandingPage(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.Header().Set("Content-Type", "text/html")
		_, _ = response.Write([]byte("<html>preview</html>"))
	}))
	defer server.Close()
	target, _ := url.Parse(server.URL)
	if err := verifyDirectZIP(context.Background(), server.Client(), target); err == nil {
		t.Fatal("expected HTML response to be rejected")
	}
}

func TestVerifyDirectZIPAcceptsBinaryHeader(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Header.Get("Range") != "bytes=0-3" {
			t.Fatalf("missing bounded range request: %q", request.Header.Get("Range"))
		}
		response.WriteHeader(http.StatusPartialContent)
		_, _ = response.Write([]byte{'P', 'K', 3, 4})
	}))
	defer server.Close()
	target, _ := url.Parse(server.URL)
	if err := verifyDirectZIP(context.Background(), server.Client(), target); err != nil {
		t.Fatal(err)
	}
}

func TestNormalizeRclonePublishedURLRejectsUnknownGoogleDriveViewerShape(t *testing.T) {
	if _, err := normalizeRclonePublishedURL("drive", "https://drive.google.com/drive/my-drive"); err == nil {
		t.Fatal("expected a non-file Google Drive viewer URL to be rejected")
	}
}

func TestNormalizeRclonePublishedURLLeavesOtherProvidersUnchanged(t *testing.T) {
	got, err := normalizeRclonePublishedURL("dropbox", "https://dropbox.example/download/archive.zip")
	if err != nil {
		t.Fatal(err)
	}
	if got.String() != "https://dropbox.example/download/archive.zip" {
		t.Fatalf("unexpected URL: %q", got.String())
	}
}
