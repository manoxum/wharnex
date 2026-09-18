package app

import (
	"context"
	"strings"
	"sync"
	"testing"

	"kernl.local/harness/backend/internal/audit"
	contextbundle "kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/planner"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/session"
)

type interviewSequencePlanner struct {
	mu       sync.Mutex
	requests []planner.Request
}

func (p *interviewSequencePlanner) Plan(_ context.Context, request planner.Request) (planner.Result, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.requests = append(p.requests, request)
	if len(p.requests) == 1 {
		return planner.Result{Turn: &domain.AgentTurn{Protocol: domain.TurnProtocolV1, RequestID: request.RequestID, Kind: domain.TurnKindClarification, Message: "Preciso de uma decisão.", Outcome: &domain.TurnOutcome{Status: domain.TurnOutcomeCompleted}, Interview: &domain.Interview{Protocol: domain.InterviewProtocolV2, Questions: []domain.InterviewQuestion{{ID: "scope", Prompt: "Qual escopo?", AllowOther: true, Options: []domain.InterviewOption{{ID: "small", Label: "Pequeno"}, {ID: "full", Label: "Completo"}}}}}}}, nil
	}
	return planner.Result{Turn: &domain.AgentTurn{Protocol: domain.TurnProtocolV1, RequestID: request.RequestID, Kind: domain.TurnKindAnswer, Message: "Entendido.", Outcome: &domain.TurnOutcome{Status: domain.TurnOutcomeCompleted}}}, nil
}

func TestInterviewAnswerContinuesSameMainRequestWithoutSpendingInterviewBudget(t *testing.T) {
	root := t.TempDir()
	plannerImpl := &interviewSequencePlanner{}
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), plannerImpl, policy.NewEngine(), fakeRunner{})
	started, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	started, err = service.SetEffortLevel(started.ID, domain.EffortLevelLow)
	if err != nil {
		t.Fatal(err)
	}

	_, interviewing, err := service.SubmitMessage(context.Background(), started.ID, "@interview desenha o fluxo")
	if err != nil {
		t.Fatal(err)
	}
	if interviewing.State != "awaiting_clarification" || interviewing.AutomationAttempt != 0 || automaticAttemptsSpent(interviewing) != 0 {
		t.Fatalf("interview should be effort-free: state=%s attempt=%d spent=%d", interviewing.State, interviewing.AutomationAttempt, automaticAttemptsSpent(interviewing))
	}
	parentID := interviewing.LastRequestID

	_, answered, err := service.SubmitMessage(context.Background(), started.ID, "Resposta da entrevista (harness.interview/v2)\n- Qual escopo?\n  - Completo")
	if err != nil {
		t.Fatal(err)
	}
	if answered.State != "answered" || answered.AutomationAttempt != 1 {
		t.Fatalf("substantive result should consume the normal attempt: state=%s attempt=%d", answered.State, answered.AutomationAttempt)
	}
	lineage := answered.RequestLineages[answered.LastRequestID]
	if lineage.Kind != requestKindInterview || lineage.ParentRequestID != parentID || lineage.RootRequestID != parentID {
		t.Fatalf("interview continuation escaped main-request lineage: %#v", lineage)
	}
	plannerImpl.mu.Lock()
	defer plannerImpl.mu.Unlock()
	if len(plannerImpl.requests) != 2 || plannerImpl.requests[1].ParentRequestID != parentID || !strings.Contains(plannerImpl.requests[1].Message, "INTERVIEW CONTINUATION") {
		t.Fatalf("unexpected continuation request: %#v", plannerImpl.requests)
	}
}
