package protocol

import (
	"strings"
	"testing"
)

func TestValidatePlanSummaryAcceptsAConcreteSentence(t *testing.T) {
	for _, summary := range []string{
		"Replace the hello greeting text in the demo file",
		"Corrige o dwell dos workers e espaça as submissões",
		"Investigated the 429 cooldown and found the level never resets",
		"  Collapses\twhitespace\nacross lines into one description  ",
	} {
		if err := ValidatePlanSummary(summary); err != nil {
			t.Fatalf("summary %q rejected: %v", summary, err)
		}
	}
}

// The summary is the only prose the self-evolution activation dialog can show,
// so an absent one leaves the operator deciding to restart with nothing to read.
func TestValidatePlanSummaryRequiresAValue(t *testing.T) {
	for _, summary := range []string{"", "   ", "\n\t "} {
		err := ValidatePlanSummary(summary)
		if err == nil {
			t.Fatalf("summary %q must be rejected", summary)
		}
		if !strings.Contains(err.Error(), "summary is required") {
			t.Fatalf("unexpected error for %q: %v", summary, err)
		}
	}
}

// Placeholders are a closed published set rather than a heuristic, so the rule
// enforced is exactly the rule the planner instructions state.
func TestValidatePlanSummaryRejectsPublishedPlaceholders(t *testing.T) {
	for _, summary := range []string{"short summary", "Short Summary", "changes", "done.", "Task completed", "n/a"} {
		if err := ValidatePlanSummary(summary); err == nil {
			t.Fatalf("placeholder %q must be rejected", summary)
		}
	}
}

func TestValidatePlanSummaryRejectsUninformativeShapes(t *testing.T) {
	if err := ValidatePlanSummary("fixed"); err == nil {
		t.Fatal("a summary too short to identify the work must be rejected")
	}
	if err := ValidatePlanSummary("refactored-the-worker-scheduler-module"); err == nil {
		t.Fatal("a single token is not a description")
	}
	if err := ValidatePlanSummary(strings.Repeat("a", MaxPlanSummaryBytes+1)); err == nil {
		t.Fatal("an oversized summary must be rejected")
	}
}
