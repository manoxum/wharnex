package app

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/audit"
	"kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/planner/manual"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/sandbox"
	"kernl.local/harness/backend/internal/selfevolution"
	"kernl.local/harness/backend/internal/session"
)

func TestEvolutionEvidenceAndAnalysisRequireCanonicalRuntimeRoot(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "main.txt"), []byte("hello"), 0o600); err != nil {
		t.Fatal(err)
	}
	bus := audit.NewBus()
	service := NewService(session.NewStore(), bus, contextbundle.NewBuilder(1<<20, 2<<20), manual.New(), policy.NewEngine(), sandbox.NewLocalRunner())
	service.selfEvolution = selfevolution.New(root)
	started, err := service.StartSession(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	bus.Publish(started.ID, "execution.failed", map[string]any{"error": "conflict"})
	evidence, err := service.EvolutionEvidence(started.ID)
	if err != nil || evidence.Total == 0 {
		t.Fatalf("canonical self-evolution evidence unavailable: %#v %v", evidence, err)
	}
	updated, _, err := service.PrepareEvolutionAnalysis(context.Background(), started.ID)
	if err != nil {
		t.Fatal(err)
	}
	if updated.LastRequestMode != "plan_first" || !strings.Contains(updated.LastManualPrompt, "WHX OPERATIONAL SELF-EVOLUTION REVIEW") {
		t.Fatalf("analysis was not prepared as a guarded plan-first request: %#v", updated)
	}
	if len(updated.EvidenceReviewIDs) == 0 {
		t.Fatal("analysis selection was not retained")
	}

	other := t.TempDir()
	if err := os.WriteFile(filepath.Join(other, "main.txt"), []byte("hello"), 0o600); err != nil {
		t.Fatal(err)
	}
	normal, err := service.StartSession(context.Background(), other)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.EvolutionEvidence(normal.ID); err == nil {
		t.Fatal("normal project received self-evolution evidence capability")
	}
	otherEvent := bus.Publish(normal.ID, "transport.failed", map[string]any{"error": "offline"})
	global, err := service.EvolutionEvidence(started.ID)
	if err != nil {
		t.Fatal(err)
	}
	foundOther := false
	for _, event := range global.Events {
		if event.ID == otherEvent.ID && event.ProjectPath == other {
			foundOther = true
		}
	}
	if !foundOther {
		t.Fatal("self-evolution did not aggregate another project")
	}
	resolved, err := service.ResolveEvolutionEvidence(started.ID, []string{otherEvent.ID})
	if err != nil {
		t.Fatal(err)
	}
	for _, event := range resolved.Events {
		if event.ID == otherEvent.ID {
			t.Fatal("resolved evidence remained visible")
		}
	}
}

func TestEvolutionKnowledgeEvidenceExcludesProjectDomainAndCanBeSelected(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "main.txt"), []byte("hello"), 0o600); err != nil {
		t.Fatal(err)
	}
	store := session.NewStore()
	bus := audit.NewBus()
	service := NewService(store, bus, contextbundle.NewBuilder(1<<20, 2<<20), manual.New(), policy.NewEngine(), sandbox.NewLocalRunner())
	service.selfEvolution = selfevolution.New(root)
	self, err := service.StartSession(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	project := t.TempDir()
	if err := os.WriteFile(filepath.Join(project, "app.txt"), []byte("app"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := service.StartSession(context.Background(), project); err != nil {
		t.Fatal(err)
	}
	_, err = store.CompareAndSwapProjectKnowledgeCatalog(project, []domain.ProjectKnowledgeEntry{
		{ID: "patch-replay", Content: "When git apply sees stale context, refresh the baseline before retrying.", Category: domain.KnowledgeCategoryPatchStrategy},
		{ID: "customer-billing", Content: "The billing screen uses a project-specific invoice rule.", Category: domain.KnowledgeCategoryProductDomain},
	}, "req-knowledge", 0)
	if err != nil {
		t.Fatal(err)
	}
	evidence, err := service.EvolutionEvidence(self.ID)
	if err != nil {
		t.Fatal(err)
	}
	if evidence.KnowledgeTotal != 1 || len(evidence.Knowledge) != 1 || evidence.Knowledge[0].ID != "patch-replay" {
		t.Fatalf("self-evolution knowledge filtering failed: %+v", evidence.Knowledge)
	}
	updated, _, err := service.PrepareEvolutionAnalysisWithKnowledge(context.Background(), self.ID, nil, []EvolutionKnowledgeRef{{ProjectPath: project, ID: "patch-replay"}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(updated.LastManualPrompt, "REUSABLE KNOWLEDGE EVIDENCE") || !strings.Contains(updated.LastManualPrompt, "patch-replay") {
		t.Fatalf("selected knowledge was not sent as evidence: %q", updated.LastManualPrompt)
	}
	if strings.Contains(updated.LastManualPrompt, "customer-billing") {
		t.Fatal("project-domain knowledge leaked into self-evolution evidence")
	}
}
