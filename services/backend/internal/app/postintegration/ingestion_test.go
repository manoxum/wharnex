package postintegration_test

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/bundlename"
	"kernl.local/harness/backend/internal/domain"
)

func TestRuntimeSuccessWithoutObservationIsRejectedAtIngestion(t *testing.T) {
	service, _, started := integratedFixture(t)
	_, current, err := service.SubmitPostIntegrationObservation(t.Context(), started.ID, "Check real runtime")
	if err != nil {
		t.Fatal(err)
	}
	turn := domain.AgentTurn{Protocol: domain.TurnProtocolV1, RequestID: current.LastRequestID,
		Kind: domain.TurnKindAnswer, Message: "Runtime fixed", Outcome: &domain.TurnOutcome{Status: domain.TurnOutcomeCompleted}}
	encoded, err := json.Marshal(turn)
	if err != nil {
		t.Fatal(err)
	}
	entries := map[string]string{
		"README.md": "# Acceptance", "turn.json": string(encoded), "summary.md": "Runtime fixed",
		"knowledge/index.json": `{"protocol":"harness.knowledge/v2","base_revision":0,"mode":"replace","entries":[]}`,
		"attempts/ledger.md":   "# Attempts\nNo runtime observation executed.",
	}
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	for name, body := range entries {
		e, err := w.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := e.Write([]byte(body)); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	filename := bundlename.Build(bundlename.KindResponse, "system", rootRequest, current.LastRequestID)
	_, err = service.SubmitExecutionBundle(t.Context(), started.ID, filename, buf.Bytes())
	if err == nil || !strings.Contains(err.Error(), "post-integration evidence must first gather runtime observations") {
		t.Fatalf("unsupported success must fail at the runtime boundary: %v", err)
	}
}
