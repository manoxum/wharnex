package protocol

import (
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/domain"
)

func TestValidateTurn(t *testing.T) {
	valid := domain.AgentTurn{Protocol: domain.TurnProtocolV1, RequestID: "req_12345678", Kind: domain.TurnKindAnswer, Message: "Resposta útil.", Outcome: &domain.TurnOutcome{Status: domain.TurnOutcomeCompleted}}
	if err := ValidateTurn(valid); err != nil {
		t.Fatal(err)
	}
	valid.Kind = domain.TurnKindPlan
	valid.Message = "## TODO\n- [ ] Rever proposta com o utilizador."
	if err := ValidateTurn(valid); err != nil {
		t.Fatalf("plan turn should be valid: %v", err)
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

func TestValidateTurnAcceptsBoundedChatTitle(t *testing.T) {
	turn := domain.AgentTurn{
		Protocol: domain.TurnProtocolV1, RequestID: "req_12345678", Kind: domain.TurnKindAnswer,
		ChatTitle: "Eliminar chats temporários de título", Message: "Resposta útil.",
		Outcome: &domain.TurnOutcome{Status: domain.TurnOutcomeCompleted},
	}
	if err := ValidateTurn(turn); err != nil {
		t.Fatalf("expected chat_title to be valid: %v", err)
	}
}

func TestValidateTurnAcceptsStructuredInterviewOnlyForClarification(t *testing.T) {
	turn := domain.AgentTurn{
		Protocol: domain.TurnProtocolV1, RequestID: "req_12345678", Kind: domain.TurnKindClarification,
		Message: "Preciso de uma decisão antes de continuar.", Outcome: &domain.TurnOutcome{Status: domain.TurnOutcomeCompleted},
		Interview: &domain.Interview{Protocol: domain.InterviewProtocolV1, Questions: []domain.InterviewQuestion{{
			ID: "retention", Prompt: "Qual a retenção pretendida?", Options: []domain.InterviewOption{{ID: "three-days", Label: "3 dias"}, {ID: "thirty-days", Label: "30 dias"}},
		}}},
	}
	if err := ValidateTurn(turn); err != nil {
		t.Fatalf("expected valid interview: %v", err)
	}
	turn.Kind = domain.TurnKindAnswer
	if err := ValidateTurn(turn); err == nil {
		t.Fatal("interview must not turn an answer into a decision surface")
	}
}

func TestValidateTurnRejectsOversizedChatTitle(t *testing.T) {
	turn := domain.AgentTurn{
		Protocol: domain.TurnProtocolV1, RequestID: "req_12345678", Kind: domain.TurnKindAnswer,
		ChatTitle: strings.Repeat("a", 83), Message: "Resposta útil.",
		Outcome: &domain.TurnOutcome{Status: domain.TurnOutcomeCompleted},
	}
	if err := ValidateTurn(turn); err == nil {
		t.Fatal("expected oversized chat_title to be rejected")
	}
}
