package app

import (
	"archive/zip"
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"kernl.local/harness/backend/internal/audit"
	contextbundle "kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/domain"
	manualplanner "kernl.local/harness/backend/internal/planner/manual"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/sandbox"
	"kernl.local/harness/backend/internal/session"
)

func TestConflictCapsuleTravelsAsAFileWithoutExpandingThePrompt(t *testing.T) {
	paths := make([]string, 19)
	for index := range paths {
		paths[index] = fmt.Sprintf("src/conflict-%02d.ts", index)
	}
	message := buildConflictResolutionMessage(paths, "")
	if len(message) >= 1<<20 {
		t.Fatalf("focused conflict message crossed Desktop's 1 MiB bound: %d", len(message))
	}
	if !strings.Contains(message, conflictCapsuleArtifactPath) {
		t.Fatalf("focused conflict message does not name its authoritative file: %q", message)
	}

	raw := bytes.Repeat([]byte("x"), 2<<20)
	item := domain.Session{LastRequestID: "req_conflict"}
	recordRequestSupportArtifact(&item, "req_conflict", conflictCapsuleArtifactPath, raw)
	artifacts := continuationArtifacts(item, "req_conflict")
	if len(artifacts) != 1 || artifacts[0].Name != conflictCapsuleArtifactPath || !bytes.Equal(artifacts[0].Raw, raw) {
		t.Fatalf("conflict capsule was not preserved as a request artifact: %#v", artifacts)
	}
}

func TestGitConflictRetryReusesItsPersistedCapsule(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "go.mod"), []byte("module example.test/retry\n\ngo 1.25\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), sandbox.NewLocalRunner())
	started, err := service.StartSession(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	oldRequestID := "req_conflict_old"
	capsule := []byte(`{"protocol":"harness.conflict/v1","conflict_id":"conflict_retry","files":[]}`)
	seeded, err := service.store.Update(started.ID, func(item *domain.Session) error {
		item.IntegrationConflict = &domain.ConflictResolution{ID: "conflict_retry", RequestID: oldRequestID, Paths: []string{"api.go"}}
		item.Plan = &domain.ExecutionPlan{PlanID: "failed-resolution", RequestID: oldRequestID}
		recordRequestSupportArtifact(item, oldRequestID, conflictCapsuleArtifactPath, capsule)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	retried, err := service.prepareConflictResolutionRetry(context.Background(), started.ID, seeded, errors.New("undefined: CandidateType"))
	if err != nil {
		t.Fatal(err)
	}
	if retried.IntegrationConflict == nil || retried.IntegrationConflict.RequestID == oldRequestID || retried.State != "conflict_resolution_pending" {
		t.Fatalf("Git-native conflict was not continued: %#v", retried.IntegrationConflict)
	}
	artifacts := continuationArtifacts(retried, retried.IntegrationConflict.RequestID)
	found := false
	for _, artifact := range artifacts {
		if artifact.Name == conflictCapsuleArtifactPath && bytes.Equal(artifact.Raw, capsule) {
			found = true
		}
	}
	if !found || !strings.Contains(retried.LastManualPrompt, "undefined: CandidateType") {
		t.Fatalf("retry lost capsule or failure evidence: artifacts=%#v prompt=%q", artifacts, retried.LastManualPrompt)
	}
}

// The repair prompt is the whole payload of a correction wave. Before this it
// carried only the latest failure, so round three re-proposed what round two had
// already disproved. It must now carry both continuation artifacts.
func TestRepairWaveCarriesMeasuredHistoryAndDivergenceVerdict(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "package.json"), []byte("{}\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), &repairFailureRunner{})
	started, err := service.StartSession(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	_, prompted, err := service.SubmitMessage(context.Background(), started.ID, "fix feature")
	if err != nil {
		t.Fatal(err)
	}
	originalRequest := prompted.LastRequestID
	// Give the Main Request a ledger, exactly as its first response would.
	if _, err := service.store.Update(started.ID, func(item *domain.Session) error {
		stageAttemptNarrative(item, originalRequest, originalRequest, "## Does not work locally\n- patching src/legacy.js: the file does not exist here\n")
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	raw := []byte(`{"protocol":"harness.execution/v1","plan_id":"failed-plan","request_id":"` + originalRequest + `","status":"ready","summary":"test failure","version_increment":{"component":"patch","amount":1},"risk":"low","requires_approval":false,"operations":[],"verification":[{"argv":["npm","run","build"],"cwd":".","timeout_seconds":30,"network":false,"expected_exit_codes":[0]}]}`)
	planned, err := service.SubmitManualPlan(started.ID, raw)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := service.Execute(context.Background(), planned.ID, true); err == nil {
		t.Fatal("expected the seeded execution to fail")
	}
	repaired, err := service.store.Get(started.ID)
	if err != nil {
		t.Fatal(err)
	}

	prompt := repaired.LastManualPrompt
	for _, want := range []string{
		"SESSION ATTEMPT LEDGER",
		domain.AttemptProtocolV1,
		"WHARNEX-MEASURED ROUND HISTORY",
		"src/legacy.js",
		"SESSION ATTEMPT LEDGER PROTOCOL",
		"Does not work locally",
	} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("repair prompt is missing %q:\n%s", want, truncateForFailure(prompt))
		}
	}
	// The failure that triggered this repair must appear as measured evidence,
	// not only as the free-form diagnostics block it always carried.
	ledger := attemptLedgerForRoot(repaired, originalRequest)
	if ledger == nil || len(ledger.Rounds) != 1 {
		t.Fatalf("expected the failed round to be measured, got %+v", ledger)
	}
	if ledger.Rounds[0].Outcome != domain.AttemptOutcomeVerificationFailed {
		t.Fatalf("expected a verification failure, got %q", ledger.Rounds[0].Outcome)
	}
	if ledger.Rounds[0].PlanID != "failed-plan" {
		t.Fatalf("measured round lost its plan id: %+v", ledger.Rounds[0])
	}
}

// Anchoring a base was previously done only for the Main Request, which meant
// every repair plan lost the base-rooted integration of ADR-0035 and applied to
// whatever the host had drifted to.
func TestEveryContinuationAnchorsItsOwnRequestBase(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is required")
	}
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "package.json"), []byte("{}\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), &repairFailureRunner{})
	started, err := service.StartSession(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	_, prompted, err := service.SubmitMessage(context.Background(), started.ID, "fix feature")
	if err != nil {
		t.Fatal(err)
	}
	originalRequest := prompted.LastRequestID

	raw := []byte(`{"protocol":"harness.execution/v1","plan_id":"failed-plan","request_id":"` + originalRequest + `","status":"ready","summary":"test failure","version_increment":{"component":"patch","amount":1},"risk":"low","requires_approval":false,"operations":[],"verification":[{"argv":["npm","run","build"],"cwd":".","timeout_seconds":30,"network":false,"expected_exit_codes":[0]}]}`)
	planned, err := service.SubmitManualPlan(started.ID, raw)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := service.Execute(context.Background(), planned.ID, true); err == nil {
		t.Fatal("expected the seeded execution to fail")
	}
	repaired, err := service.store.Get(started.ID)
	if err != nil {
		t.Fatal(err)
	}
	if repaired.LastRequestID == originalRequest {
		t.Fatal("expected a fresh repair request")
	}
	if requestBaseCommit(repaired, repaired.LastRequestID) == "" {
		t.Fatalf("the repair request anchored no base commit: %#v", repaired.RequestBaseCommits)
	}
}

// An identical fingerprint is a positive answer the planner acts on: a patch
// that failed to apply did not fail because the tree moved.
func TestUnchangedProjectProducesAnExplicitUnchangedVerdict(t *testing.T) {
	delta := domain.ContextDelta{
		Protocol: domain.ContextDeltaProtocolV1, BaseRequestID: "req_root", CurrentRequestID: "req_two",
		BaseManifestSHA256: "abc", CurrentManifestSHA: "abc", Source: domain.ContextDeltaSourceManifest, Unchanged: true,
	}
	rendered := renderContextDelta(delta)
	if !strings.Contains(rendered, "VERDICT: UNCHANGED") {
		t.Fatalf("expected an explicit unchanged verdict:\n%s", rendered)
	}
	if !strings.Contains(rendered, "did not fail because the tree moved") {
		t.Fatalf("the unchanged verdict must say what it implies:\n%s", rendered)
	}
}

// An unmeasurable divergence must say so rather than imply nothing changed;
// silently reporting "no files" would be a lie the planner would act on.
func TestUnmeasurableDivergenceIsReportedAsUnknown(t *testing.T) {
	delta := domain.ContextDelta{
		Protocol: domain.ContextDeltaProtocolV1, BaseRequestID: "req_root", CurrentRequestID: "req_two",
		Source: domain.ContextDeltaSourceUnavailable, PatchOmittedReason: "no git repository",
	}
	rendered := renderContextDelta(delta)
	if !strings.Contains(rendered, "VERDICT: UNKNOWN") || !strings.Contains(rendered, "no git repository") {
		t.Fatalf("expected an explicit unknown verdict naming the reason:\n%s", rendered)
	}
}

// Small diffs are inlined because a continuation prompt is read in full on
// every transport, while a side-file reference is worth nothing to a runtime
// that never fetched it.
func TestSmallDivergencePatchIsInlinedIntoThePrompt(t *testing.T) {
	delta := domain.ContextDelta{
		Protocol: domain.ContextDeltaProtocolV1, BaseRequestID: "req_root", CurrentRequestID: "req_two",
		Source: domain.ContextDeltaSourceGit,
		Files:  []domain.ContextDeltaFile{{Path: "a.go", Status: "modified", Additions: 2, Deletions: 1}},
		Patch:  "diff --git a/a.go b/a.go\n@@\n-old\n+new\n",
	}
	rendered := renderContextDelta(delta)
	if !strings.Contains(rendered, "diff --git a/a.go b/a.go") {
		t.Fatalf("expected the diff inline:\n%s", rendered)
	}
	if !strings.Contains(rendered, "REFERENCE ONLY") {
		t.Fatalf("an inlined diff must be marked reference-only so it is not echoed back as a patch:\n%s", rendered)
	}
	if !strings.Contains(rendered, "a.go (modified, +2/-1)") {
		t.Fatalf("expected the measured line counts:\n%s", rendered)
	}
}

// A bookkeeping artifact must never discard a verified executable payload.
func TestResponseWithoutAttemptLedgerIsAcceptedAndDegraded(t *testing.T) {
	root := t.TempDir()
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	started, err := service.StartSession(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	_, prompted, err := service.SubmitMessage(context.Background(), started.ID, "explain the project")
	if err != nil {
		t.Fatal(err)
	}
	requestID := prompted.LastRequestID
	if _, err := service.SubmitExecutionBundle(context.Background(), started.ID, "whx_bundle_res_system_"+requestID+".zip",
		answerBundleWithLedger(t, requestID, "")); err != nil {
		t.Fatalf("a response without attempts/ledger.md must still be accepted: %v", err)
	}
	degraded := false
	for _, event := range service.bus.History(started.ID) {
		if event.Type == "attempts.ledger_degraded" {
			degraded = true
		}
	}
	if !degraded {
		t.Fatal("a missing ledger must be published as a degradation so the gap is visible")
	}
}

// A session mid-Main-Request must hand both attempt artifacts to whichever
// transport carries the next wave, so a planner reading files sees the same
// evidence the prompt describes.
func TestContinuationTransportCarriesBothAttemptArtifacts(t *testing.T) {
	item := domain.Session{ID: "sess", LastRequestID: "req_two"}
	resetAttemptLedger(&item, "req_root")
	item.RequestLineages = map[string]domain.RequestLineage{
		"req_two": {RequestID: "req_two", RootRequestID: "req_root", ParentRequestID: "req_root", Kind: requestKindRepair},
	}
	recordAttemptRound(&item, "req_root", domain.AttemptRound{RequestID: "req_root", Outcome: domain.AttemptOutcomeVerificationFailed, Detail: "go test exited 1"})
	stageAttemptNarrative(&item, "req_root", "req_root", "## Does not work locally\n- npm ci: the runner image has no network\n")
	recordRequestContextDelta(&item, "req_two", domain.ContextDelta{
		Protocol: domain.ContextDeltaProtocolV1, BaseRequestID: "req_root", CurrentRequestID: "req_two",
		Source: domain.ContextDeltaSourceGit, Patch: "diff --git a/a.go b/a.go\n",
	})

	names := make([]string, 0, 4)
	for _, artifact := range continuationArtifacts(item, "req_two") {
		names = append(names, artifact.Name)
	}
	for _, want := range []string{"attempts/state.json", "attempts/ledger.md", "context-delta/delta.json", "context-delta/delta.patch"} {
		if !containsString(names, want) {
			t.Fatalf("continuation transport is missing %q, got %v", want, names)
		}
	}
}

func TestAdjustmentPromptFollowsRepairDescendants(t *testing.T) {
	item := domain.Session{ID: "sess", LastRequestID: "req_repair"}
	item.RequestLineages = map[string]domain.RequestLineage{
		"req_root":   {RequestID: "req_root", RootRequestID: "req_root", Kind: requestKindStandard},
		"req_adjust": {RequestID: "req_adjust", RootRequestID: "req_root", ParentRequestID: "req_root", Kind: requestKindPlanAdjustment},
		"req_repair": {RequestID: "req_repair", RootRequestID: "req_root", ParentRequestID: "req_adjust", Kind: requestKindRepair},
	}
	recordRequestSupportArtifact(&item, "req_root", mainRequestArtifactPath, []byte("pedido principal"))
	recordRequestSupportArtifact(&item, "req_adjust", adjustmentRequestArtifactPath, []byte("mantenha apenas a UI"))

	byName := map[string]string{}
	for _, artifact := range continuationArtifacts(item, "req_repair") {
		byName[artifact.Name] = string(artifact.Raw)
	}
	if byName[mainRequestArtifactPath] != "pedido principal" || byName[adjustmentRequestArtifactPath] != "mantenha apenas a UI" {
		t.Fatalf("repair descendant lost adjustment scope: %#v", byName)
	}
}

func TestContinuationTransportCarriesCumulativeExecutionEvidenceAndResponses(t *testing.T) {
	store := session.NewStore()
	bus := audit.NewBus()
	service := NewService(store, bus, contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	objects := &memoryArtifactStore{objects: map[string][]byte{}}
	service.SetArtifactStore(objects, 30)
	item := domain.Session{
		ID: "sess-history", ProjectPath: t.TempDir(), LastRequestID: "req_repair", CreatedAt: time.Now().UTC(),
		RequestLineages: map[string]domain.RequestLineage{
			"req_root":   {RequestID: "req_root", RootRequestID: "req_root", Kind: requestKindStandard},
			"req_repair": {RequestID: "req_repair", RootRequestID: "req_root", ParentRequestID: "req_root", Kind: requestKindRepair},
		},
	}
	resetAttemptLedger(&item, "req_root")
	recordRequestContextDelta(&item, "req_repair", domain.ContextDelta{Protocol: domain.ContextDeltaProtocolV1, BaseRequestID: "req_root", CurrentRequestID: "req_repair", Source: domain.ContextDeltaSourceGit, Unchanged: true})
	if err := store.Put(item); err != nil {
		t.Fatal(err)
	}
	bus.Publish(item.ID, "execution.started", map[string]any{"request_id": "req_root", "plan_id": "plan_root"})
	bus.Publish(item.ID, "command.completed", map[string]any{"run_id": "run_1", "argv": []string{"go", "test", "./..."}, "exit_code": 1, "stdout": "FAIL TestRegression", "stderr": ""})
	response := testArtifactZIP(t, map[string]string{"turn.json": `{"request_id":"req_root"}`})
	if _, err := service.PersistArtifact(context.Background(), item.ID, "req_root", "output", "bundle", "response.zip", "application/zip", response); err != nil {
		t.Fatal(err)
	}

	artifacts := service.RequestContinuationArtifactsWithHistory(context.Background(), item.ID, "req_repair")
	byName := map[string][]byte{}
	for _, artifact := range artifacts {
		byName[artifact.Name] = artifact.Raw
	}
	if !strings.Contains(string(byName["attempts/events.json"]), "FAIL TestRegression") {
		t.Fatalf("cumulative command output is missing: %s", byName["attempts/events.json"])
	}
	for _, want := range []string{`"waves"`, `"request_id": "req_root"`, `"request_id": "req_repair"`} {
		if !strings.Contains(string(byName["attempts/events.json"]), want) {
			t.Fatalf("execution evidence is not explicitly grouped by correction wave %q: %s", want, byName["attempts/events.json"])
		}
	}
	if len(byName["responses/001-req_root.zip"]) == 0 || len(byName["responses/index.json"]) == 0 {
		t.Fatalf("prior response bundle history is missing from %d continuation artifacts", len(byName))
	}
}

// The ledger has exactly the lifetime of one Main Request. A terminal answer
// ends that request, so its durable residue is already in the knowledge catalog
// and the scaffolding must not survive to bias the next goal.
func TestTerminalResponseStagesTheLedgerThenDiscardsIt(t *testing.T) {
	root := t.TempDir()
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	started, err := service.StartSession(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	_, prompted, err := service.SubmitMessage(context.Background(), started.ID, "explain the project")
	if err != nil {
		t.Fatal(err)
	}
	requestID := prompted.LastRequestID
	ledger := "## Goal\nfix the build\n\n## Does not work locally\n- npm ci: the runner image has no network\n"
	if _, err := service.SubmitExecutionBundle(context.Background(), started.ID, "whx_bundle_res_system_"+requestID+".zip",
		answerBundleWithLedger(t, requestID, ledger)); err != nil {
		t.Fatal(err)
	}
	staged := false
	for _, event := range service.bus.History(started.ID) {
		if event.Type == "attempts.ledger_staged" {
			staged = true
		}
	}
	if !staged {
		t.Fatal("the response ledger must be staged on ingestion")
	}
	current, err := service.store.Get(started.ID)
	if err != nil {
		t.Fatal(err)
	}
	if attemptLedgerForRoot(current, requestID) != nil {
		t.Fatal("a terminal response must discard the session ledger; its durable residue belongs in the knowledge catalog")
	}
}

func answerBundleWithLedger(t *testing.T, requestID, ledger string) []byte {
	t.Helper()
	entries := map[string]string{
		"README.md": "# Answer\n",
		"turn.json": `{"protocol":"harness.turn/v1","request_id":"` + requestID + `","kind":"answer","message":"done","outcome":{"status":"completed","retryable":false}}`,
	}
	addV2ResponseArtifacts(entries, "Cumulative summary for the test response.")
	if ledger != "" {
		entries["attempts/ledger.md"] = ledger
	}
	var out bytes.Buffer
	writer := zip.NewWriter(&out)
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

func truncateForFailure(value string) string {
	if len(value) <= 4000 {
		return value
	}
	return value[:4000] + "\n...[truncated]"
}

func TestPlanReversalCapsuleTravelsWithItsDerivedRequest(t *testing.T) {
	item := domain.Session{ID: "sess", LastRequestID: "req_reversal", RequestLineages: map[string]domain.RequestLineage{
		"req_root":     {RequestID: "req_root", RootRequestID: "req_root", Kind: requestKindStandard},
		"req_reversal": {RequestID: "req_reversal", RootRequestID: "req_root", ParentRequestID: "req_root", Kind: requestKindPlanReversal},
	}}
	recordRequestSupportArtifact(&item, "req_root", mainRequestArtifactPath, []byte("pedido principal"))
	capsule := []byte(`{"protocol":"harness.plan-reversal/v1","current_context_sha256":"abc"}`)
	recordRequestSupportArtifact(&item, "req_reversal", planReversalArtifactPath, capsule)

	byName := map[string][]byte{}
	for _, artifact := range continuationArtifacts(item, "req_reversal") {
		byName[artifact.Name] = artifact.Raw
	}
	if string(byName[mainRequestArtifactPath]) != "pedido principal" || !bytes.Equal(byName[planReversalArtifactPath], capsule) {
		t.Fatalf("reversal continuation lost authoritative evidence: %#v", byName)
	}
}
