package sandbox

import (
	"strings"
	"testing"
)

func TestRunnerImageUnavailableErrorDirectsOperatorToExplicitLocalBuild(t *testing.T) {
	err := runnerImageUnavailableError("kernl-runner:local")
	message := err.Error()
	for _, want := range []string{
		"kernl-runner:local",
		"will not pull runner images",
		"make build-runner RUNNER_IMAGE=\"kernl-runner:local\"",
	} {
		if !strings.Contains(message, want) {
			t.Fatalf("missing %q in %q", want, message)
		}
	}
}

func TestRunnerImageUnavailableErrorExplainsMissingConfiguration(t *testing.T) {
	if got := runnerImageUnavailableError("").Error(); !strings.Contains(got, "is not configured") {
		t.Fatalf("unexpected error: %q", got)
	}
}
