package app

import (
	"context"
	"fmt"
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

func TestSelectedEvolutionEventsBalancesDefaultKnowledgeSample(t *testing.T) {
	var events []EvolutionEvidenceEvent
	appendCategory := func(project, category, prefix string, count int) {
		for index := 0; index < count; index++ {
			events = append(events, EvolutionEvidenceEvent{
				Event:       domain.Event{ID: fmt.Sprintf("%s-%02d", prefix, index)},
				ProjectPath: project,
				Category:    category,
			})
		}
	}
	appendCategory("/workspace/a", "atividade", "activity", 5)
	appendCategory("/workspace/a", "erro", "error", 20)
	appendCategory("/workspace/b", "protocolo", "protocol", 20)
	appendCategory("/workspace/c", "sucesso", "success", 20)
	appendCategory("/workspace/d", "transporte", "transport", 20)
	appendCategory("/workspace/e", "policy", "policy", 20)

	sampled, mode := selectedEvolutionEvents(events, nil, false, true)
	if mode != "knowledge_with_event_sample" {
		t.Fatalf("unexpected selection mode: %s", mode)
	}
	if len(sampled) != defaultEvolutionEventSampleMax {
		t.Fatalf("expected bounded sample of %d events, got %d", defaultEvolutionEventSampleMax, len(sampled))
	}
	categoryCounts := map[string]int{}
	projectCounts := map[string]int{}
	for _, event := range sampled {
		if event.Category == "atividade" {
			t.Fatal("low-signal activity event entered the default knowledge sample")
		}
		categoryCounts[event.Category]++
		projectCounts[event.ProjectPath]++
	}
	for category, count := range categoryCounts {
		if count > defaultEvolutionEventSampleCategory {
			t.Fatalf("category %s exceeded quota: %d", category, count)
		}
	}
	for project, count := range projectCounts {
		if count > defaultEvolutionEventSamplePerProject {
			t.Fatalf("project %s exceeded quota: %d", project, count)
		}
	}

	again, againMode := selectedEvolutionEvents(events, nil, false, true)
	if againMode != mode || eventIDs(again) != eventIDs(sampled) {
		t.Fatalf("sampling is not deterministic: %s/%q vs %s/%q", mode, eventIDs(sampled), againMode, eventIDs(again))
	}
	if strings.Contains(eventIDs(sampled), "error-00") || !strings.Contains(eventIDs(sampled), "error-19") {
		t.Fatalf("sample did not prefer recent events within quota: %s", eventIDs(sampled))
	}
}

func TestSelectedEvolutionEventsPreservesExplicitAndKnowledgeOnlyModes(t *testing.T) {
	events := []EvolutionEvidenceEvent{
		{Event: domain.Event{ID: "activity"}, ProjectPath: "/workspace/a", Category: "atividade"},
		{Event: domain.Event{ID: "failed"}, ProjectPath: "/workspace/a", Category: "erro"},
		{Event: domain.Event{ID: "applied"}, ProjectPath: "/workspace/a", Category: "sucesso"},
	}
	explicit, mode := selectedEvolutionEvents(events, []string{"activity", "applied"}, false, true)
	if mode != "explicit_events" || eventIDs(explicit) != "activity,applied" {
		t.Fatalf("explicit selection changed: mode=%s ids=%s", mode, eventIDs(explicit))
	}
	knowledgeOnly, mode := selectedEvolutionEvents(events, nil, false, false)
	if mode != "knowledge_only" || len(knowledgeOnly) != 0 {
		t.Fatalf("knowledge-only opt-out included events: mode=%s ids=%s", mode, eventIDs(knowledgeOnly))
	}
}

func eventIDs(events []EvolutionEvidenceEvent) string {
	ids := make([]string, 0, len(events))
	for _, event := range events {
		ids = append(ids, event.ID)
	}
	return strings.Join(ids, ",")
}
