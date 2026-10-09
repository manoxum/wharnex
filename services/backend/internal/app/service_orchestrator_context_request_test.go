package app

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/audit"
	"kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/session"
)

func TestOrchestratorPlanningIncrementValidatesAndAccumulatesCapturedFiles(t *testing.T) {
	root := t.TempDir()
	for _, name := range []string{"first.txt", "second.txt"} {
		if err := os.WriteFile(filepath.Join(root, name), []byte(name), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), orchestratorManualTestPlanner{}, policy.NewEngine(), fakeRunner{})
	service.SetArtifactStore(&memoryArtifactStore{objects: map[string][]byte{}}, 30)
	owner, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	planning, err := service.ProposeOrchestratorPlan(context.Background(), owner.ID, "Plan the work")
	if err != nil {
		t.Fatal(err)
	}
	request := func(paths string) []byte {
		return orchestratorBundle(t, map[string]string{"context-request.json": `{"protocol":"harness.orchestrator-context-request/v1","request_id":"` + planning.RequestID + `","context_paths":` + paths + `}`})
	}
	first, err := service.ImportOrchestratorProposalBundle(context.Background(), owner.ID, planning.RequestID, request(`["context/first.txt"]`))
	if err != nil {
		t.Fatal(err)
	}
	if first.Delivery != "context_increment" || len(first.ContextPaths) != 1 || first.ContextPaths[0] != "context/first.txt" {
		t.Fatalf("first increment: %#v", first)
	}
	second, err := service.ImportOrchestratorProposalBundle(context.Background(), owner.ID, planning.RequestID, request(`["context/second.txt"]`))
	if err != nil {
		t.Fatal(err)
	}
	if len(second.ContextPaths) != 2 {
		t.Fatalf("selection was not cumulative: %#v", second.ContextPaths)
	}
	if _, err := service.ImportOrchestratorProposalBundle(context.Background(), owner.ID, planning.RequestID, request(`["context/../missing.txt"]`)); err == nil {
		t.Fatal("unsafe path accepted")
	}
	current, err := service.GetSession(owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	if current.OrchestratorContextRounds[planning.RequestID] != 2 {
		t.Fatalf("round count = %d", current.OrchestratorContextRounds[planning.RequestID])
	}
}

func TestOrchestratorPartialPlanningIsSeededWithNormativeDocuments(t *testing.T) {
	root := t.TempDir()
	for name, value := range map[string]string{"AGENTS.md": "# rules", "SECURITY.md": "# security", "first.txt": "first"} {
		if err := os.WriteFile(filepath.Join(root, name), []byte(value), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), orchestratorManualTestPlanner{}, policy.NewEngine(), fakeRunner{})
	service.SetArtifactStore(&memoryArtifactStore{objects: map[string][]byte{}}, 30)
	owner, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	planning, err := service.ProposeOrchestratorPlan(context.Background(), owner.ID, "Plan the work", OrchestratorComposerContext{IncludeContext: true})
	if err != nil {
		t.Fatal(err)
	}
	tasks, err := service.store.ListChatAgentTasks(session.ChatAgentTaskFilter{SessionID: owner.ID, Type: "ORCHESTRATOR_PLAN", Limit: 1})
	if err != nil || len(tasks) != 1 {
		t.Fatalf("planning worker not queued: %v %d", err, len(tasks))
	}
	var payload orchestratorPlanningWorkerPayload
	if err := json.Unmarshal(tasks[0].Payload, &payload); err != nil {
		t.Fatal(err)
	}
	if strings.Join(payload.ContextPaths, ",") != "context/AGENTS.md,context/SECURITY.md" {
		t.Fatalf("first planning archive must carry the normative documents: %#v", payload.ContextPaths)
	}
	increment := orchestratorBundle(t, map[string]string{"context-request.json": `{"protocol":"harness.orchestrator-context-request/v1","request_id":"` + planning.RequestID + `","context_paths":["context/first.txt"]}`})
	result, err := service.ImportOrchestratorProposalBundle(context.Background(), owner.ID, planning.RequestID, increment)
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(result.ContextPaths, ","); got != "context/AGENTS.md,context/SECURITY.md,context/first.txt" {
		t.Fatalf("increment must accumulate on top of the normative seed: %s", got)
	}
}

func TestDecodeOrchestratorContextRequestHasNoPathCountCeiling(t *testing.T) {
	paths := make([]string, 64)
	for i := range paths {
		paths[i] = fmt.Sprintf("context/file-%03d.txt", i)
	}
	raw := orchestratorBundle(t, map[string]string{"context-request.json": `{"protocol":"harness.orchestrator-context-request/v1","request_id":"orp_12345678","context_paths":["` + strings.Join(paths, `","`) + `"]}`})
	request, ok, err := decodeOrchestratorContextRequest(raw)
	if err != nil {
		t.Fatal(err)
	}
	if !ok || len(request.ContextPaths) != 64 {
		t.Fatalf("unexpected parsed request: ok=%v paths=%d", ok, len(request.ContextPaths))
	}
}
