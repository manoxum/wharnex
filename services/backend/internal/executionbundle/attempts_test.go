package executionbundle

import (
	"strings"
	"testing"
)

func attemptsTurnBundle(t *testing.T, ledger string) []byte {
	t.Helper()
	entries := map[string]string{
		"README.md": "# Answer\n",
		"turn.json": `{"protocol":"harness.turn/v1","request_id":"req_12345678","kind":"answer","message":"done","outcome":{"status":"completed","retryable":false}}`,
	}
	if ledger != "" {
		entries["attempts/ledger.md"] = ledger
	}
	return zipBytes(t, entries)
}

func TestParseExtractsTheAttemptLedger(t *testing.T) {
	parsed, err := Parse("whx_bundle_res_chat_req_12345678.zip", attemptsTurnBundle(t, "## Does not work locally\n- npm ci has no network\n"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(parsed.Info.AttemptLedgerNarrative, "npm ci has no network") {
		t.Fatalf("attempt ledger was not extracted: %q", parsed.Info.AttemptLedgerNarrative)
	}
}

// The ledger exists to make the NEXT round cheaper. Rejecting a bundle because
// its companion note is absent would discard a verified patch to protect a note
// about patches — precisely the self-inflicted round trip this removes.
func TestParseAcceptsABundleWithNoAttemptLedger(t *testing.T) {
	parsed, err := Parse("whx_bundle_res_chat_req_12345678.zip", attemptsTurnBundle(t, ""))
	if err != nil {
		t.Fatalf("a bundle without attempts/ledger.md must still parse: %v", err)
	}
	if parsed.Info.AttemptLedgerNarrative != "" {
		t.Fatalf("expected no ledger, got %q", parsed.Info.AttemptLedgerNarrative)
	}
}

// An oversized ledger means the planner is pasting logs into a decision aid.
// It is dropped so the previous round's distilled ledger survives, and the
// executable payload is still accepted.
func TestParseDropsAnOversizedAttemptLedgerWithoutFailing(t *testing.T) {
	parsed, err := Parse("whx_bundle_res_chat_req_12345678.zip", attemptsTurnBundle(t, strings.Repeat("x", maxAttemptLedgerBytes+1)))
	if err != nil {
		t.Fatalf("an oversized ledger must not fail the bundle: %v", err)
	}
	if parsed.Info.AttemptLedgerNarrative != "" {
		t.Fatalf("an oversized ledger must be dropped, got %d bytes", len(parsed.Info.AttemptLedgerNarrative))
	}
}
