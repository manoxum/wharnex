package buildhost_test

import (
	"context"
	"path/filepath"
	"strings"
	"testing"

	selfevolution "kernl.local/harness/backend/internal/selfevolution"
)

func TestBuildHostStreamsOutputAsItArrivesInsteadOfOnlyAtCompletion(t *testing.T) {
	// A host build can run for minutes; without incremental delivery it
	// looks hung until it finally succeeds or fails. onOutput must fire
	// for each chunk as it is produced, not just once at the end.
	root := fakeRoot(t)
	mustWrite(t, filepath.Join(root, "hello.txt"), "before\n", 0o644)
	mustWrite(t, filepath.Join(root, "Makefile"), "build-stage:\n"+
		"\t@printf 'first line\\n'\n"+
		"\t@printf 'second line\\n' >&2\n", 0o644)
	patch := "--- a/hello.txt\n+++ b/hello.txt\n@@ -1 +1 @@\n-before\n+after\n"
	manager := selfevolution.New(root)
	tx, err := manager.Prepare("ses-stream", "plan-stream", []string{patch})
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Release()

	type chunk struct{ stream, text string }
	var chunks []chunk
	full, err := manager.BuildHost(context.Background(), tx, func(stream, text string) {
		chunks = append(chunks, chunk{stream, text})
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(chunks) == 0 {
		t.Fatal("expected at least one streamed chunk")
	}
	var streamedStdout, streamedStderr strings.Builder
	for _, c := range chunks {
		switch c.stream {
		case "stdout":
			streamedStdout.WriteString(c.text)
		case "stderr":
			streamedStderr.WriteString(c.text)
		default:
			t.Fatalf("unexpected stream label %q", c.stream)
		}
	}
	if !strings.Contains(streamedStdout.String(), "first line") {
		t.Fatalf("expected streamed stdout to contain the stdout line, got %q", streamedStdout.String())
	}
	if !strings.Contains(streamedStderr.String(), "second line") {
		t.Fatalf("expected streamed stderr to contain the stderr line, got %q", streamedStderr.String())
	}
	// The streamed chunks must be a live view of the SAME output BuildHost
	// still accumulates and returns whole, not a separate/lossy channel.
	if !strings.Contains(full, "first line") || !strings.Contains(full, "second line") {
		t.Fatalf("accumulated output missing streamed content: %q", full)
	}
}

func TestBuildHostRetainsTerminalFailureAfterVerboseBuildOutput(t *testing.T) {
	root := fakeRoot(t)
	mustWrite(t, filepath.Join(root, "hello.txt"), "before\n", 0o644)
	// More than the bounded capture limit precedes the actual failure. The
	// terminal diagnostic must remain available for classification/recovery.
	mustWrite(t, filepath.Join(root, "Makefile"), "build-stage:\n"+
		"\t@yes x | head -c 600000\n"+
		"\t@printf 'TERMINAL BUILD FAILURE: missing generated symbol\\n' >&2\n"+
		"\t@exit 2\n", 0o644)
	patch := "--- a/hello.txt\n+++ b/hello.txt\n@@ -1 +1 @@\n-before\n+after\n"
	manager := selfevolution.New(root)
	tx, err := manager.Prepare("ses-terminal-output", "plan-terminal-output", []string{patch})
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Release()

	output, err := manager.BuildHost(context.Background(), tx, nil)
	if err == nil {
		t.Fatal("expected build failure")
	}
	if !strings.Contains(output, "TERMINAL BUILD FAILURE: missing generated symbol") {
		t.Fatalf("terminal build diagnostic was discarded: %q", output[len(output)-min(len(output), 512):])
	}
	if !strings.Contains(output, "middle build output truncated") {
		t.Fatalf("expected bounded-output truncation marker, got %q", output[:min(len(output), 512)])
	}
}

func TestIsHostToolchainMismatchIsNarrow(t *testing.T) {
	positive := []string{
		"Error [ERR_REQUIRE_ESM]: require() of ES Module ... not supported",
		"Error: Electron failed to install correctly. Please delete `node_modules/electron`",
		"flock: unrecognized option: w",
	}
	for _, output := range positive {
		if !selfevolution.IsHostToolchainMismatch(output) {
			t.Fatalf("expected match for output: %s", output)
		}
	}
	negative := []string{
		"",
		"npm warn EBADENGINE Unsupported engine { package: 'eslint-visitor-keys@5.0.1' }",
		"FAIL services/frontend/src/App.test.ts\nExpected 2 but received 3",
		"go build failed: undefined: foo",
	}
	for _, output := range negative {
		if selfevolution.IsHostToolchainMismatch(output) {
			t.Fatalf("expected no match for output: %s", output)
		}
	}
}
