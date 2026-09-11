package protocol

import (
	"fmt"
	"strings"
)

// Plan summary shape limits. The summary is the one sentence a human reads to
// learn what a bundle did — in the chat transcript, and in the self-evolution
// activation dialog, where it is the only prose standing between the operator
// and a decision to restart the runtime. It is therefore short by contract:
// long enough to identify the work, short enough to be read at a glance.
const (
	MinPlanSummaryDetail = 16
	MaxPlanSummaryBytes  = 600
)

// forbiddenPlanSummaries are the low-information summaries the protocol
// explicitly instructs the planner never to emit. Like the commit-message set,
// it is a closed list rather than a heuristic, so the rule that is enforced is
// exactly the rule that was published.
var forbiddenPlanSummaries = map[string]bool{
	"summary": true, "short summary": true, "plan": true, "plan summary": true,
	"execution plan": true, "changes": true, "change": true, "update": true,
	"updates": true, "update files": true, "apply patch": true, "apply patches": true,
	"requested changes": true, "requested change": true, "implement task": true,
	"implement changes": true, "code changes": true, "done": true, "completed": true,
	"task completed": true, "recommendation prepared": true, "no summary": true,
	"n/a": true, "none": true, "ok": true, "wharness-verified change": true,
	"wharnex-verified change": true, "cleanup": true, "fixes": true, "patch": true,
}

// ValidatePlanSummary enforces the summary contract for a plan-bearing response
// bundle.
//
// It runs at bundle ingestion, deliberately BEFORE policy and sandbox
// verification, for the same reason the commit message does: a summary rejected
// here costs one re-request, whereas discovering it missing after verification
// would mean either discarding a verified candidate or — worse — presenting the
// operator an activation dialog that cannot say what it is activating.
//
// The summary is prose for a human, not transport metadata, so it is bounded
// but never parsed for structure beyond collapsing it to a single paragraph's
// worth of text.
func ValidatePlanSummary(raw string) error {
	if len(raw) > MaxPlanSummaryBytes {
		return fmt.Errorf("summary exceeds %d byte limit; it is a short description of what was done, not the full report", MaxPlanSummaryBytes)
	}
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return fmt.Errorf("summary is required: it is what Wharnex shows the operator to explain what this bundle did")
	}
	normalized := strings.ToLower(strings.TrimRight(collapseSummaryWhitespace(trimmed), "."))
	if forbiddenPlanSummaries[normalized] {
		return fmt.Errorf("summary is a placeholder (%q); state concretely what was implemented, corrected or investigated", trimmed)
	}
	if len(normalized) < MinPlanSummaryDetail {
		return fmt.Errorf("summary %q is too short to identify the work; state concretely what was implemented, corrected or investigated", trimmed)
	}
	if !strings.ContainsAny(normalized, " \t") {
		return fmt.Errorf("summary %q is a single token, not a description", trimmed)
	}
	return nil
}

// collapseSummaryWhitespace normalizes the runs of spaces, tabs and newlines a
// model may emit so the length and placeholder checks see one canonical form.
func collapseSummaryWhitespace(value string) string {
	return strings.Join(strings.Fields(value), " ")
}
