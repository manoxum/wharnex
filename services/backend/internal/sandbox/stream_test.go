package sandbox

import (
	"context"
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/domain"
)

func TestLocalRunnerStreamsCommandOutput(t *testing.T) {
	runner := NewLocalRunner()
	workspace := Workspace{Path: t.TempDir()}
	var chunks []string
	result, err := runner.RunStreaming(context.Background(), workspace, domain.CommandSpec{
		Argv: []string{"printf", "hello-stream"}, Cwd: ".", TimeoutSeconds: 5, ExpectedExitCodes: []int{0},
	}, func(stream, text string) {
		chunks = append(chunks, stream+":"+text)
	})
	if err != nil {
		t.Fatal(err)
	}
	if !result.Success || result.Stdout != "hello-stream" {
		t.Fatalf("unexpected result: %#v", result)
	}
	if !strings.Contains(strings.Join(chunks, ""), "stdout:hello-stream") {
		t.Fatalf("stdout was not streamed: %#v", chunks)
	}
}
