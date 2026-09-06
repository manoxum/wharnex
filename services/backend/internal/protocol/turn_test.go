package protocol

import (
	"testing"

	"kernl.local/harness/backend/internal/domain"
)

func TestValidateTurn(t *testing.T) {
	valid := domain.AgentTurn{Protocol: domain.TurnProtocolV1, RequestID: "req_12345678", Kind: domain.TurnKindAnswer, Message: "Resposta útil.", Outcome: &domain.TurnOutcome{Status: domain.TurnOutcomeCompleted}}
	if err := ValidateTurn(valid); err != nil {
		t.Fatal(err)
	}
	valid.Kind = domain.TurnKind("execute")
	if err := ValidateTurn(valid); err == nil {
		t.Fatal("expected unsupported turn kind rejection")
	}
}

func TestValidateTurnEvidenceResolutionIDs(t *testing.T) {
	turn := domain.AgentTurn{Protocol: domain.TurnProtocolV1, RequestID: "req_12345678", Kind: domain.TurnKindChange, Message: "implemented", Outcome: &domain.TurnOutcome{Status: domain.TurnOutcomeCompleted}, ResolvedEvidenceIDs: []string{"evt_12345678"}}
	if err := ValidateTurn(turn); err != nil {
		t.Fatal(err)
	}
	turn.ResolvedEvidenceIDs = []string{"not-an-event"}
	if err := ValidateTurn(turn); err == nil {
		t.Fatal("expected invalid evidence id rejection")
	}
}

func TestValidateWorkflowTurn(t *testing.T) {
	turn := domain.AgentTurn{Protocol: domain.TurnProtocolV1, RequestID: "req_12345678", Kind: domain.TurnKindWorkflow, Message: "Vou recolher evidência local.", Outcome: &domain.TurnOutcome{Status: domain.TurnOutcomeCompleted}}
	if err := ValidateTurn(turn); err != nil {
		t.Fatal(err)
	}
}

func TestValidateTurnRequiresOutcomeAndFailureDetail(t *testing.T) {
	turn := domain.AgentTurn{Protocol: domain.TurnProtocolV1, RequestID: "req_12345678", Kind: domain.TurnKindBlocked, Message: "Não concluído."}
	if err := ValidateTurn(turn); err == nil {
		t.Fatal("expected missing outcome rejection")
	}
	turn.Outcome = &domain.TurnOutcome{Status: domain.TurnOutcomeFailed, Retryable: true}
	if err := ValidateTurn(turn); err == nil {
		t.Fatal("expected missing failure detail rejection")
	}
	turn.Outcome.Message = "O contexto necessário não estava disponível."
	if err := ValidateTurn(turn); err != nil {
		t.Fatal(err)
	}
}
