package protocol

import (
	"testing"

	"kernl.local/harness/backend/internal/domain"
)

func TestValidateTurn(t *testing.T) {
	valid := domain.AgentTurn{Protocol: domain.TurnProtocolV1, RequestID: "req_12345678", Kind: domain.TurnKindAnswer, Message: "Resposta útil."}
	if err := ValidateTurn(valid); err != nil {
		t.Fatal(err)
	}
	valid.Kind = domain.TurnKind("execute")
	if err := ValidateTurn(valid); err == nil {
		t.Fatal("expected unsupported turn kind rejection")
	}
}

func TestValidateWorkflowTurn(t *testing.T) {
	turn := domain.AgentTurn{Protocol: domain.TurnProtocolV1, RequestID: "req_12345678", Kind: domain.TurnKindWorkflow, Message: "Vou recolher evidência local."}
	if err := ValidateTurn(turn); err != nil {
		t.Fatal(err)
	}
}
