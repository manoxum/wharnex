package app

import (
	"archive/zip"
	"bytes"
	"context"
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/audit"
	contextbundle "kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/domain"
	manualplanner "kernl.local/harness/backend/internal/planner/manual"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/projectknowledge"
	"kernl.local/harness/backend/internal/session"
)

func makeKnowledgeReviewAnswerBundle(t *testing.T, requestID, message, knowledgeMd string) []byte {
	t.Helper()
	var out bytes.Buffer
	writer := zip.NewWriter(&out)
	entries := map[string]string{
		"README.md": "# Knowledge review\n",
		"turn.json": `{"protocol":"harness.turn/v1","request_id":"` + requestID + `","kind":"answer","message":"` + message + `","outcome":{"status":"completed","retryable":false}}`,
	}
	addV2ResponseArtifacts(entries, "Resumo cumulativo da resposta de teste.")
	if knowledgeMd != "" {
		entries["knowledge.md"] = knowledgeMd
	}
	for name, value := range entries {
		entry, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write([]byte(value)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}

func TestNewSessionStartsWithKnowledgeSharingEnabled(t *testing.T) {
	root := t.TempDir()
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	started, err := service.StartSession(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if started.KnowledgeSharingEnabled == nil || !*started.KnowledgeSharingEnabled {
		t.Fatal("new chats must start with project knowledge sharing enabled")
	}
}

func TestTriggerKnowledgeReviewDoesNotMutateStateOrPlan(t *testing.T) {
	root := t.TempDir()
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	started, err := service.StartSession(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	plan := &domain.ExecutionPlan{PlanID: "plan-untouched", RequestID: "req-untouched", Status: "ready"}
	if _, err := service.store.Update(started.ID, func(item *domain.Session) error {
		item.State = "applied"
		item.Plan = plan
		item.LastRequestID = "req-main"
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	service.triggerKnowledgeReview(context.Background(), started.ID)

	after, err := service.store.Get(started.ID)
	if err != nil {
		t.Fatal(err)
	}
	if after.State != "applied" {
		t.Fatalf("triggerKnowledgeReview must not change State, got %q", after.State)
	}
	if after.Plan != plan {
		t.Fatalf("triggerKnowledgeReview must not touch Plan, got %#v", after.Plan)
	}
	if after.PendingKnowledgeReviewRequestID == "" {
		t.Fatal("expected a pending knowledge review request id")
	}
	if !containsString(after.PendingManualRequestIDs, after.PendingKnowledgeReviewRequestID) {
		t.Fatal("expected the knowledge review request id to be pending delivery")
	}
	if !strings.Contains(after.LastManualPrompt, "WHX KNOWLEDGE REVIEW") {
		t.Fatal("expected the manual prompt to be the dedicated knowledge review prompt")
	}
	lineage, ok := after.RequestLineages[after.PendingKnowledgeReviewRequestID]
	if !ok || lineage.Kind != requestKindKnowledgeReview || lineage.ParentRequestID != "req-main" {
		t.Fatalf("expected knowledge_review lineage parented on the main request, got %#v", lineage)
	}
}

func TestIngestKnowledgeReviewResponseUpdatesKnowledgeWithoutTouchingState(t *testing.T) {
	root := t.TempDir()
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	started, err := service.StartSession(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	plan := &domain.ExecutionPlan{PlanID: "plan-untouched", RequestID: "req-untouched", Status: "ready"}
	if _, err := service.store.Update(started.ID, func(item *domain.Session) error {
		item.State = "restart_pending"
		item.Plan = plan
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	service.triggerKnowledgeReview(context.Background(), started.ID)
	pending, err := service.store.Get(started.ID)
	if err != nil {
		t.Fatal(err)
	}
	requestID := pending.PendingKnowledgeReviewRequestID
	if requestID == "" {
		t.Fatal("expected a pending knowledge review request")
	}

	bundle := makeKnowledgeReviewAnswerBundle(t, requestID, "Resumo do trabalho.", "# Wharness knowledge\n\n- Node do host tem de ser >=22.12.\n")
	result, err := service.SubmitExecutionBundle(context.Background(), started.ID, "whx_bundle_res_system_"+requestID+".zip", bundle)
	if err != nil {
		t.Fatal(err)
	}
	if result.Session.State != "restart_pending" {
		t.Fatalf("ingestKnowledgeReviewResponse must not change State, got %q", result.Session.State)
	}
	if result.Session.Plan != plan {
		t.Fatalf("ingestKnowledgeReviewResponse must not touch Plan, got %#v", result.Session.Plan)
	}
	if result.Session.PendingKnowledgeReviewRequestID != "" {
		t.Fatal("expected the pending knowledge review marker to be cleared")
	}
	if containsString(result.Session.PendingManualRequestIDs, requestID) {
		t.Fatal("expected the request id to be removed from pending manual requests")
	}
	if result.Session.LastTurn == nil || result.Session.LastTurn.Message != "Resumo do trabalho." {
		t.Fatalf("expected the summary turn to be retained as LastTurn, got %#v", result.Session.LastTurn)
	}
	saved, ok, err := service.store.GetProjectKnowledge(root)
	if err != nil {
		t.Fatal(err)
	}
	if !ok || !strings.Contains(saved.Content, "Node do host tem de ser >=22.12") || saved.Version != 1 {
		t.Fatalf("expected the knowledge document to be persisted, got %#v", saved)
	}
	if saved.UpdatedByRequestID != requestID {
		t.Fatalf("updated_by_request_id = %q, want %q", saved.UpdatedByRequestID, requestID)
	}
}

func TestIngestKnowledgeReviewResponseWithoutKnowledgeFileLeavesStoreUntouched(t *testing.T) {
	root := t.TempDir()
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	started, err := service.StartSession(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	service.triggerKnowledgeReview(context.Background(), started.ID)
	pending, err := service.store.Get(started.ID)
	if err != nil {
		t.Fatal(err)
	}
	requestID := pending.PendingKnowledgeReviewRequestID

	bundle := makeKnowledgeReviewAnswerBundle(t, requestID, "Nada de novo para reter.", "")
	if _, err := service.SubmitExecutionBundle(context.Background(), started.ID, "whx_bundle_res_system_"+requestID+".zip", bundle); err != nil {
		t.Fatal(err)
	}
	if _, ok, err := service.store.GetProjectKnowledge(root); err != nil {
		t.Fatal(err)
	} else if ok {
		t.Fatal("expected no knowledge to be recorded when ChatGPT declines to update it")
	}
}

func TestKnowledgeMdOutsideTheReviewBranchIsStructurallyIgnored(t *testing.T) {
	// Guards the core invariant: the knowledge source can only change at
	// the end of a task, by construction — a knowledge.md that arrives on
	// an ordinary (non knowledge_review) response must never be read.
	root := t.TempDir()
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	started, err := service.StartSession(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	_, prompted, err := service.SubmitMessage(context.Background(), started.ID, "Que funcionalidade deveríamos adicionar a seguir?")
	if err != nil {
		t.Fatal(err)
	}
	bundle := makeKnowledgeReviewAnswerBundle(t, prompted.LastRequestID, "Resposta normal.", "# Sneaked-in knowledge\n")
	if _, err := service.SubmitExecutionBundle(context.Background(), started.ID, "whx_bundle_res_system_"+prompted.LastRequestID+".zip", bundle); err != nil {
		t.Fatal(err)
	}
	if _, ok, err := service.store.GetProjectKnowledge(root); err != nil {
		t.Fatal(err)
	} else if ok {
		t.Fatal("a knowledge.md outside the knowledge_review branch must never be persisted")
	}
}

func TestSubmitMessageAttachesKnowledgeCatalogOnEveryEnabledRequest(t *testing.T) {
	root := t.TempDir()
	store := session.NewStore()
	if _, err := store.AppendProjectKnowledge(root, "- Prior learning from an earlier chat.", "req-earlier"); err != nil {
		t.Fatal(err)
	}
	service := NewService(store, audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	started, err := service.StartSession(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}

	first, firstSession, err := service.SubmitMessage(context.Background(), started.ID, "Primeira pergunta neste chat.")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(first.ManualPrompt, "harness.knowledge/v2") || strings.Contains(first.ManualPrompt, "Prior learning from an earlier chat") {
		t.Fatal("the prompt must require active knowledge use without inlining knowledge content")
	}
	firstSnapshot := firstSession.RequestKnowledge[firstSession.LastRequestID]
	if !firstSnapshot.SharingEnabled || len(firstSnapshot.Entries) != 1 || !strings.Contains(firstSnapshot.Entries[0].Content, "Prior learning") {
		t.Fatalf("expected separate knowledge entry on first request: %#v", firstSnapshot)
	}

	second, secondSession, err := service.SubmitMessage(context.Background(), started.ID, "Segunda pergunta no mesmo chat.")
	if err != nil {
		t.Fatal(err)
	}
	secondSnapshot := secondSession.RequestKnowledge[secondSession.LastRequestID]
	if !strings.Contains(second.ManualPrompt, "harness.knowledge/v2") || !secondSnapshot.SharingEnabled || len(secondSnapshot.Entries) != 1 {
		t.Fatalf("later enabled request must still attach the catalog: %#v", secondSnapshot)
	}
}

func TestExplicitKnowledgeDisableAcknowledgesCurrentRevision(t *testing.T) {
	root := t.TempDir()
	store := session.NewStore()
	if _, err := store.CompareAndSwapProjectKnowledgeCatalog(root, []domain.ProjectKnowledgeEntry{{ID: "existing-learning", Content: "Conhecimento já existente."}}, "req-existing", 0); err != nil {
		t.Fatal(err)
	}
	service := NewService(store, audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	started, err := service.StartSession(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	disabled, err := service.SetKnowledgeSharingEnabled(started.ID, false)
	if err != nil {
		t.Fatal(err)
	}
	if disabled.KnowledgeLastSeenRevision != 1 {
		t.Fatalf("disable must acknowledge the current catalog revision, got %d", disabled.KnowledgeLastSeenRevision)
	}
	result, current, err := service.SubmitMessage(context.Background(), started.ID, "Pedido sem conhecimento")
	if err != nil {
		t.Fatal(err)
	}
	snapshot := current.RequestKnowledge[current.LastRequestID]
	if snapshot.SharingEnabled || len(snapshot.Entries) != 0 || !strings.Contains(result.ManualPrompt, "sharing=off") {
		t.Fatalf("explicit disable was overridden without a newer revision: %#v", snapshot)
	}
}

func TestParallelKnowledgeRevisionReenablesSharingOnNextRequest(t *testing.T) {
	root := t.TempDir()
	store := session.NewStore()
	service := NewService(store, audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	started, err := service.StartSession(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := service.SubmitMessage(context.Background(), started.ID, "Primeiro pedido"); err != nil {
		t.Fatal(err)
	}
	if _, err := service.SetKnowledgeSharingEnabled(started.ID, false); err != nil {
		t.Fatal(err)
	}
	if _, err := store.CompareAndSwapProjectKnowledgeCatalog(root, []domain.ProjectKnowledgeEntry{{ID: "parallel-learning", Content: "Aprendizagem criada noutro chat."}}, "req-parallel", 0); err != nil {
		t.Fatal(err)
	}

	result, current, err := service.SubmitMessage(context.Background(), started.ID, "Pedido seguinte")
	if err != nil {
		t.Fatal(err)
	}
	snapshot := current.RequestKnowledge[current.LastRequestID]
	if !snapshot.SharingEnabled || len(snapshot.Entries) != 1 || !strings.Contains(result.ManualPrompt, "sharing=on") {
		t.Fatalf("a newer project revision must re-enable and attach knowledge: %#v", snapshot)
	}
	if current.KnowledgeSharingEnabled == nil || !*current.KnowledgeSharingEnabled {
		t.Fatal("forced refresh must visibly re-enable the per-chat toggle")
	}
}

func TestProjectKnowledgeFilesAreImportedBeforePlanning(t *testing.T) {
	root := t.TempDir()
	if err := projectknowledge.Save(root, []domain.ProjectKnowledgeEntry{{ID: "shared-learning", Content: "Conhecimento partilhado por outro developer."}}); err != nil {
		t.Fatal(err)
	}
	store := session.NewStore()
	service := NewService(store, audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	started, err := service.StartSession(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	result, current, err := service.SubmitMessage(context.Background(), started.ID, "Usar conhecimento partilhado")
	if err != nil {
		t.Fatal(err)
	}
	snapshot := current.RequestKnowledge[current.LastRequestID]
	if !snapshot.SharingEnabled || len(snapshot.Entries) != 1 || snapshot.Entries[0].ID != "shared-learning" {
		t.Fatalf("filesystem knowledge was not attached: %#v", snapshot)
	}
	if strings.Contains(result.ManualPrompt, "Conhecimento partilhado por outro developer") {
		t.Fatal("filesystem knowledge content must stay in its separate request file")
	}
	catalog, ok, err := store.GetProjectKnowledgeCatalog(root)
	if err != nil || !ok || catalog.Revision != 1 || len(catalog.Entries) != 1 {
		t.Fatalf("filesystem catalog was not mirrored into separate DB records: ok=%v err=%v catalog=%#v", ok, err, catalog)
	}
}

// Knowledge lives in the local database. Committing it must not touch the
// project tree: a store inside the repository made every catalog write a
// working-tree mutation, which is what forced knowledge to carry its own
// merge-conflict partitioning and its own capture exclusions.
func TestCommitPendingKnowledgePersistsToTheDatabaseAndNotTheProjectTree(t *testing.T) {
	root := t.TempDir()
	store := session.NewStore()
	service := NewService(store, audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	started, err := service.StartSession(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	requestID := "req-terminal-knowledge"
	if _, err := store.Update(started.ID, func(item *domain.Session) error {
		item.LastRequestID = requestID
		recordRequestLineage(item, requestID, "", requestKindStandard)
		recordRequestKnowledge(item, requestID, domain.RequestKnowledgeSnapshot{Protocol: domain.KnowledgeProtocolV2, State: domain.KnowledgeStateNone, SharingEnabled: true})
		item.PendingKnowledgeRootRequestID = requestID
		item.PendingKnowledgeCandidate = &domain.ProjectKnowledgeCandidate{BaseRevision: 0, Mode: domain.KnowledgeCandidateReplace, Entries: []domain.ProjectKnowledgeEntry{{ID: "apply-order", Content: "Persistir depois do Apply."}}}
		item.PendingKnowledgeSummary = "Resumo cumulativo."
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	committed, err := service.commitPendingKnowledge(started.ID, requestID)
	if err != nil {
		t.Fatal(err)
	}
	if committed.LastMainRequestSummary != "Resumo cumulativo." {
		t.Fatalf("summary not committed: %q", committed.LastMainRequestSummary)
	}
	catalog, ok, err := store.GetProjectKnowledgeCatalog(root)
	if err != nil || !ok || len(catalog.Entries) != 1 || catalog.Entries[0].ID != "apply-order" {
		t.Fatalf("DB knowledge record was not committed: ok=%v err=%v catalog=%#v", ok, err, catalog)
	}
	if !strings.Contains(catalog.Entries[0].Content, "depois do Apply") {
		t.Fatalf("committed record lost its content: %#v", catalog.Entries[0])
	}
	if _, present, loadErr := projectknowledge.Load(root); loadErr != nil || present {
		t.Fatalf("committing knowledge must not write into the project tree: present=%v err=%v", present, loadErr)
	}
}

func TestCommitPendingKnowledgeUsesCandidateSourceSnapshotDuringParallelChange(t *testing.T) {
	root := t.TempDir()
	store := session.NewStore()
	baseCatalog, err := store.CompareAndSwapProjectKnowledgeCatalog(root, []domain.ProjectKnowledgeEntry{{ID: "apply-order", Content: "old"}}, "req-base", 0)
	if err != nil {
		t.Fatal(err)
	}
	service := NewService(store, audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	started, err := service.StartSession(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	const sourceRequest = "req-source-knowledge"
	const terminalRequest = "req-terminal-continuation"
	if _, err := store.Update(started.ID, func(item *domain.Session) error {
		recordRequestLineage(item, sourceRequest, "", requestKindStandard)
		recordRequestLineage(item, terminalRequest, sourceRequest, requestKindRepair)
		recordRequestKnowledge(item, sourceRequest, domain.RequestKnowledgeSnapshot{Protocol: domain.KnowledgeProtocolV2, State: domain.KnowledgeStatePresent, SharingEnabled: true, Revision: baseCatalog.Revision, Entries: append([]domain.ProjectKnowledgeEntry(nil), baseCatalog.Entries...), SHA256: knowledgeCatalogDigest(baseCatalog.Entries)})
		item.PendingKnowledgeRootRequestID = sourceRequest
		item.PendingKnowledgeCandidateRequestID = sourceRequest
		item.PendingKnowledgeCandidate = &domain.ProjectKnowledgeCandidate{BaseRevision: baseCatalog.Revision, Mode: domain.KnowledgeCandidateReplace, Entries: []domain.ProjectKnowledgeEntry{{ID: "apply-order", Content: "improved"}}}
		item.PendingKnowledgeSummary = "Resumo."
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	parallel, err := store.CompareAndSwapProjectKnowledgeCatalog(root, []domain.ProjectKnowledgeEntry{{ID: "apply-order", Content: "old"}, {ID: "parallel-learning", Content: "keep me"}}, "req-parallel", baseCatalog.Revision)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Update(started.ID, func(item *domain.Session) error {
		recordRequestKnowledge(item, terminalRequest, domain.RequestKnowledgeSnapshot{Protocol: domain.KnowledgeProtocolV2, State: domain.KnowledgeStatePresent, SharingEnabled: true, Revision: parallel.Revision, Entries: append([]domain.ProjectKnowledgeEntry(nil), parallel.Entries...), SHA256: knowledgeCatalogDigest(parallel.Entries)})
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := service.commitPendingKnowledge(started.ID, terminalRequest); err != nil {
		t.Fatal(err)
	}
	final, ok, err := store.GetProjectKnowledgeCatalog(root)
	if err != nil || !ok {
		t.Fatalf("read final catalog: ok=%v err=%v", ok, err)
	}
	got := knowledgeEntryMap(final.Entries)
	if got["apply-order"].Content != "improved" || got["parallel-learning"].Content != "keep me" {
		t.Fatalf("source snapshot reconciliation lost parallel knowledge: %#v", final.Entries)
	}
}

func TestCommitPendingKnowledgePreservesDeletionAcrossCumulativeRounds(t *testing.T) {
	root := t.TempDir()
	store := session.NewStore()
	baseCatalog, err := store.CompareAndSwapProjectKnowledgeCatalog(root, []domain.ProjectKnowledgeEntry{
		{ID: "drop-me", Content: "superseded"},
		{ID: "keep-me", Content: "keep"},
	}, "req-base", 0)
	if err != nil {
		t.Fatal(err)
	}
	service := NewService(store, audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	started, err := service.StartSession(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	const derivedRequest = "req-derived-cumulative"
	if _, err := store.Update(started.ID, func(item *domain.Session) error {
		recordRequestLineage(item, derivedRequest, "req-main", requestKindRepair)
		recordRequestKnowledge(item, derivedRequest, domain.RequestKnowledgeSnapshot{
			Protocol: domain.KnowledgeProtocolV2, State: domain.KnowledgeStatePresent, SharingEnabled: true,
			Revision: baseCatalog.Revision,
			// The derived request received the already-staged view, where drop-me
			// is absent, while BaseEntries preserves the durable revision baseline.
			Entries:     []domain.ProjectKnowledgeEntry{{ID: "keep-me", Content: "keep"}},
			BaseEntries: append([]domain.ProjectKnowledgeEntry(nil), baseCatalog.Entries...),
			SHA256:      knowledgeCatalogDigest([]domain.ProjectKnowledgeEntry{{ID: "keep-me", Content: "keep"}}),
		})
		item.PendingKnowledgeRootRequestID = "req-main"
		item.PendingKnowledgeCandidateRequestID = derivedRequest
		item.PendingKnowledgeCandidate = &domain.ProjectKnowledgeCandidate{BaseRevision: baseCatalog.Revision, Mode: domain.KnowledgeCandidateReplace, Entries: []domain.ProjectKnowledgeEntry{
			{ID: "keep-me", Content: "keep"}, {ID: "new-learning", Content: "new"},
		}}
		item.PendingKnowledgeSummary = "Resumo cumulativo."
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := service.commitPendingKnowledge(started.ID, derivedRequest); err != nil {
		t.Fatal(err)
	}
	final, ok, err := store.GetProjectKnowledgeCatalog(root)
	if err != nil || !ok {
		t.Fatalf("read final catalog: ok=%v err=%v", ok, err)
	}
	got := knowledgeEntryMap(final.Entries)
	if _, exists := got["drop-me"]; exists {
		t.Fatalf("cumulative delete was lost across derived round: %#v", final.Entries)
	}
	if got["keep-me"].Content != "keep" || got["new-learning"].Content != "new" {
		t.Fatalf("unexpected final catalog: %#v", final.Entries)
	}
}

func TestSelectKnowledgeReviewHistoryPreservesEarlyPatchFailure(t *testing.T) {
	history := make([]domain.Event, 0, 700)
	for i := 0; i < 700; i++ {
		event := domain.Event{Type: "planner.progress", Data: map[string]any{"index": i}}
		if i == 25 {
			event = domain.Event{Type: "changeset.apply_failed", Data: map[string]any{"error": "patch rejected"}}
		}
		history = append(history, event)
	}
	selected := selectKnowledgeReviewHistory(history)
	if len(selected) > maxKnowledgeReviewHistoryEvents {
		t.Fatalf("selected %d events, cap is %d", len(selected), maxKnowledgeReviewHistoryEvents)
	}
	found := false
	for _, event := range selected {
		if event.Type == "changeset.apply_failed" {
			found = true
			break
		}
	}
	if !found {
		t.Fatal("early patch failure must survive bounded knowledge-review history selection")
	}
}
