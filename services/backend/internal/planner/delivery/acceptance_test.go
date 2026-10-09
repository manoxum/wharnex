package delivery_test

import (
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/planner"
)

func TestCorrectiveRequestRequiresSeparateRuntimeAcceptanceEvidence(t *testing.T) {
	manual := planner.BuildManualPrompt(planner.Request{
		RequestID: "req-deleted-visits",
		Message:   "Deleted visits still appear in realtime and direct detail URLs",
	})
	for name, instructions := range map[string]string{
		"consumer archive":      manual,
		"provider instructions": planner.SystemProtocol + planner.IntegrationOutcomeGuidance,
	} {
		t.Run(name, func(t *testing.T) {
			for _, contract := range []string{
				"RUNTIME ACCEPTANCE EVIDENCE",
				"prepared change, Protected test evidence, host integration, and observed runtime acceptance",
				"mocked query tests alone do not prove the live symptom is resolved",
				"reported entry points and an unaffected valid case",
				"checks actually run and checks still pending",
				"bounded stage identifiers, native error codes (including SQLSTATE",
				"successful partial evidence",
				"Client wrapper codes alone must not replace the underlying failure",
				"credentials, connection strings, raw business records or unbounded error messages",
				"inspect stage failure flags and missing prerequisites",
			} {
				if !strings.Contains(instructions, contract) {
					t.Fatalf("missing acceptance boundary %q", contract)
				}
			}
		})
	}
}
