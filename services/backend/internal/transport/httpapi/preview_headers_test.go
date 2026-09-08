package httpapi

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestApplyPreviewSecurityHeadersLocksDownHTML(t *testing.T) {
	recorder := httptest.NewRecorder()
	applyPreviewSecurityHeaders(recorder, "text/html; charset=utf-8")

	if got := recorder.Header().Get("Content-Security-Policy"); !strings.Contains(got, "default-src 'none'") || !strings.Contains(got, "connect-src 'none'") {
		t.Fatalf("unexpected HTML CSP: %q", got)
	}
	if got := recorder.Header().Get("Referrer-Policy"); got != "no-referrer" {
		t.Fatalf("unexpected referrer policy: %q", got)
	}
	if got := recorder.Header().Get("X-Content-Type-Options"); got != "nosniff" {
		t.Fatalf("unexpected nosniff header: %q", got)
	}
}

func TestApplyPreviewSecurityHeadersKeepsNonHTMLPassive(t *testing.T) {
	recorder := httptest.NewRecorder()
	applyPreviewSecurityHeaders(recorder, "image/png")

	if got := recorder.Header().Get("Content-Security-Policy"); got != "" {
		t.Fatalf("non-HTML preview should not receive HTML CSP, got %q", got)
	}
	if got := recorder.Header().Get("Cache-Control"); got != "private, no-store" {
		t.Fatalf("unexpected cache policy: %q", got)
	}
}
