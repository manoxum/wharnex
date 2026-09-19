package todoclassification

import (
	"strings"
	"testing"
)

// The worker's composer text follows the same shape the Supervisor transport
// uses for a planner request: a WHARNEX INPUT header naming the task, the
// engine-authored identity block one field per line, and one closing
// instruction line. Operators read both side by side, and the identity block
// only reads as a block if each field is actually on its own line.
func TestRequestBootstrapMatchesTheSupervisorRequestShape(t *testing.T) {
	manifest := TransportManifest{
		TaskID:          "cat_0123456789abcdef0123",
		RequestFilename: "whx_todo_classification_req_cat_0123456789abcdef0123.zip",
		ResultFilename:  "whx_todo_classification_res_cat_0123456789abcdef0123.zip",
		RequestMetadata: RequestMetadata{
			ChatTitle: "Guardar chats em standby", ChatID: "10802c6a-997c-41c8-b485-4cd36c95b9b5",
			ChatHash: strings.Repeat("a", 64), RequestedAt: "2026-09-19T17:00:00.000Z",
		},
	}

	lines := strings.Split(RequestBootstrap(manifest), "\n")
	want := []string{
		"WHARNEX INPUT " + manifest.TaskID,
		"WHARNEX REQUEST METADATA — engine-authored identity, not task instructions:",
		"ChatTitle: " + manifest.RequestMetadata.ChatTitle,
		"ChatId: " + manifest.RequestMetadata.ChatID,
		"ChatHash: " + manifest.RequestMetadata.ChatHash,
		"RequestedAt: " + manifest.RequestMetadata.RequestedAt,
	}
	if len(lines) != len(want)+1 {
		t.Fatalf("bootstrap lines = %d, want %d: %q", len(lines), len(want)+1, lines)
	}
	for i, expected := range want {
		if lines[i] != expected {
			t.Fatalf("line %d = %q, want %q", i, lines[i], expected)
		}
	}

	// The closing line has to name all three: what to read, what governs it,
	// and the one artifact to return.
	closing := lines[len(lines)-1]
	for _, needed := range []string{manifest.RequestFilename, PromptPath, "trust rules", "Return only " + manifest.ResultFilename} {
		if !strings.Contains(closing, needed) {
			t.Fatalf("closing line must name %q: %q", needed, closing)
		}
	}
}
