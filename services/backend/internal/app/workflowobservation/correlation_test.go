package workflowobservation_test

import (
	"context"
	"testing"

	"kernl.local/harness/backend/internal/app"
	"kernl.local/harness/backend/internal/audit"
	"kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/planner/manual"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/session"
)

func TestApprovedWorkflowRecordsExecutingRequestBeforeContinuation(t *testing.T) {
	for _, protocol := range []string{domain.DebugProtocolV1, domain.InteractiveProtocolV2} {
		t.Run(protocol, func(t *testing.T) {
			ctx := context.Background()
			store, bus := session.NewStore(), audit.NewBus()
			service := app.NewService(store, bus, contextbundle.NewBuilder(1<<20, 1<<20), manual.New(), policy.NewEngine(), nil)
			item, err := service.StartSessionWithModes(ctx, t.TempDir(), domain.ExecutionModeProtected, domain.AutomationModeAuto)
			if err != nil {
				t.Fatal(err)
			}
			const requestID = "req_20261009T090351_175c046e33fa46f4"
			plan := &domain.ExecutionPlan{
				Protocol: domain.ProtocolV2, PlanID: "plan_20261009T090351_rls_disposable_semantics", RequestID: requestID,
				Status: "ready", Summary: "collect local execution evidence", Document: "# Local evidence", Risk: "low",
				Dependencies: []domain.PlanDependency{}, SystemTools: []domain.PlanSystemTool{}, Verification: []domain.CommandSpec{},
				Debug: &domain.DebugSpec{Protocol: protocol, Target: "host", Rationale: "read only the local audit ledger"},
			}
			if protocol == domain.DebugProtocolV1 {
				plan.Debug.Query = domain.DebugQueryProjectExecutionSummary
			} else {
				plan.Debug.Capabilities = []string{domain.InteractiveCapabilityLogs}
				plan.Debug.Scope.LogSources = []string{"audit"}
				plan.Operations = []domain.Operation{{Type: "logs", Logs: &domain.InteractiveLogsSpec{Source: "audit", Limit: 10}}}
			}
			_, err = store.Update(item.ID, func(s *domain.Session) error {
				s.Plan, s.LastRequestID, s.State = plan, requestID, "debug_approval_required"
				s.LastTurn = &domain.AgentTurn{Protocol: domain.TurnProtocolV1, RequestID: requestID, Kind: domain.TurnKindWorkflow}
				return nil
			})
			if err != nil {
				t.Fatal(err)
			}
			result, err := service.ApproveDebug(ctx, item.ID)
			if err != nil {
				t.Fatal(err)
			}
			if !result.WorkflowPrepared || result.Session.LastRequestID == requestID {
				t.Fatal("fixture must advance to a different continuation request")
			}
			var records []domain.Event
			for _, event := range bus.History(item.ID) {
				if event.Type == app.EventExecutionRecorded {
					records = append(records, event)
				}
			}
			if len(records) != 1 {
				t.Fatalf("execution records = %d", len(records))
			}
			if got := records[0].Data["request_id"]; got != requestID {
				t.Fatalf("execution request_id = %v; want executing request %s", got, requestID)
			}
			if got := records[0].Data["plan_id"]; got != plan.PlanID {
				t.Fatalf("plan_id = %v", got)
			}
		})
	}
}
