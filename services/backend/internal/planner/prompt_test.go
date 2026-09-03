package planner

import (
	"strings"
	"testing"
)

func TestBuildManualPromptUsesExecutionBundleDelivery(t *testing.T) {
	const requestID = "req_20260902T222529_d18d51d84abc677c"
	prompt := BuildManualPrompt(Request{RequestID: requestID, Message: "update UI"})

	for _, want := range []string{
		"wharness-bundle-" + requestID + ".zip",
		"REAL DOWNLOADABLE ZIP ATTACHMENT",
		"plan.json",
		"README.md",
		"patches/",
		"patch_file",
		"BUNDLE_GENERATION_UNAVAILABLE",
		"return ONLY the generated downloadable ZIP attachment",
		"Write no acknowledgement, progress report, summary, explanation",
		"attachment is the entire final response",
		requestID,
		"harness.turn/v1",
		"answer",
		"clarification",
		"investigation",
		"Only change turns may contain plan.json",
	} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("manual prompt missing %q", want)
		}
	}
}
