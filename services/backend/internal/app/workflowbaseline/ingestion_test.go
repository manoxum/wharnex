package workflowbaseline_test

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"kernl.local/harness/backend/internal/app"
	"kernl.local/harness/backend/internal/audit"
	"kernl.local/harness/backend/internal/bundlename"
	"kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/planner/manual"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/session"
)

func TestWorkflowIngestionAcrossUnrelatedFixtureChange(t *testing.T) {
	for _, changed := range []string{"parallel-fixture.txt", "rules.txt"} {
		t.Run(changed, func(t *testing.T) {
			ctx, root := context.Background(), t.TempDir()
			if err := os.WriteFile(filepath.Join(root, "rules.txt"), []byte("original"), 0600); err != nil {
				t.Fatal(err)
			}
			store, bus, builder := session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20)
			service := app.NewService(store, bus, builder, manual.New(), policy.NewEngine(), nil)
			item, err := service.StartSessionWithModes(ctx, root, domain.ExecutionModeProtected, domain.AutomationModeAuto)
			if err != nil {
				t.Fatal(err)
			}
			_, item, err = service.SubmitMessage(ctx, item.ID, "Diagnose local runtime evidence")
			if err != nil {
				t.Fatal(err)
			}
			before := item.Context.Manifest.SHA256
			plan := domain.ExecutionPlan{
				Protocol: domain.ProtocolV2, PlanID: "workflow-evidence", RequestID: item.LastRequestID,
				Status: "ready", Summary: "collect local evidence", Document: "# Evidence", Risk: "low",
				BaseContextSHA256: before, ReadFiles: []string{"rules.txt"},
				Dependencies: []domain.PlanDependency{}, SystemTools: []domain.PlanSystemTool{}, Operations: []domain.Operation{}, Verification: []domain.CommandSpec{},
				Debug: &domain.DebugSpec{Protocol: domain.DebugProtocolV1, Target: "host", Query: domain.DebugQueryProjectExecutionSummary, Rationale: "read local audit only"},
			}
			if err := os.WriteFile(filepath.Join(root, changed), []byte("parallel change"), 0600); err != nil {
				t.Fatal(err)
			}
			latest, err := builder.Build(root)
			if err != nil {
				t.Fatal(err)
			}
			_, err = store.Update(item.ID, func(s *domain.Session) error {
				s.Context = latest
				s.ProjectRevisions = append(s.ProjectRevisions, domain.ProjectRevision{ParentSHA256: before, SHA256: latest.Manifest.SHA256, ChangedFiles: []string{changed}, Complete: true})
				return nil
			})
			if err != nil {
				t.Fatal(err)
			}
			filename := bundlename.Build(bundlename.KindResponse, "system", item.LastRequestID, "")
			result, err := service.SubmitExecutionBundle(ctx, item.ID, filename, workflowBundle(t, plan))
			if changed == "rules.txt" {
				if err == nil {
					t.Fatal("changed read dependency must refuse stale workflow")
				}
				return
			}
			if err != nil {
				t.Fatalf("unrelated fixture must preserve useful workflow: %v", err)
			}
			if result.Session.State != "debug_approval_required" || result.Session.Plan.BaseContextSHA256 != latest.Manifest.SHA256 {
				t.Fatalf("workflow must advance baseline while retaining approval: %s", result.Session.State)
			}
			if result.Execution != nil {
				t.Fatal("baseline adaptation cannot grant execution")
			}
		})
	}
}

func workflowBundle(t *testing.T, plan domain.ExecutionPlan) []byte {
	t.Helper()
	turn := domain.AgentTurn{Protocol: domain.TurnProtocolV1, RequestID: plan.RequestID, Kind: domain.TurnKindWorkflow, Message: "Collect local evidence", Outcome: &domain.TurnOutcome{Status: domain.TurnOutcomeCompleted}}
	p, err := json.Marshal(plan)
	if err != nil {
		t.Fatal(err)
	}
	v, err := json.Marshal(turn)
	if err != nil {
		t.Fatal(err)
	}
	entries := map[string]string{
		"README.md": "# Local diagnostic workflow", "turn.json": string(v), "plan.json": string(p),
		"summary.md": "Diagnosis pending approval", "knowledge/index.json": `{"protocol":"harness.knowledge/v2","base_revision":0,"mode":"replace","entries":[]}`,
		"attempts/ledger.md": "# Attempts\nNo diagnostic execution yet.",
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
	return buf.Bytes()
}
