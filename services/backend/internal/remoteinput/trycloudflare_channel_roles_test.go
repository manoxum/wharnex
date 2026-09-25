package remoteinput

import (
	"strings"
	"testing"
)

func TestTryCloudflareAcceptsEveryCurrentRemoteFileMapRole(t *testing.T) {
	digest := strings.Repeat("a", 64)
	roles := []string{
		"context",
		"context-map",
		"knowledge",
		"continuation",
		"git-context",
		"attachment",
		"artifact",
	}
	for _, role := range roles {
		path := "files/" + role + "/" + digest
		if !validChannelResourcePath(path) {
			t.Fatalf("remote file-map role %q is rejected by the tunnel provider", role)
		}
		if !validChannelContentType(path, "application/octet-stream") {
			t.Fatalf("remote file-map role %q rejects its binary content type", role)
		}
	}
}
