package main

import (
	"net/http"
	"testing"
	"time"
)

func TestHTTPServerAllowsBoundedLargeArtifactUploads(t *testing.T) {
	server := newHTTPServer(":0", http.NotFoundHandler())
	if server.ReadHeaderTimeout != 5*time.Second {
		t.Fatalf("unexpected header timeout: %s", server.ReadHeaderTimeout)
	}
	if server.ReadTimeout != 30*time.Minute {
		t.Fatalf("artifact upload read timeout = %s, want 30m", server.ReadTimeout)
	}
	if server.WriteTimeout != 30*time.Minute {
		t.Fatalf("unexpected write timeout: %s", server.WriteTimeout)
	}
}
