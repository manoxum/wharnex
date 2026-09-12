package app

import (
	"archive/zip"
	"bytes"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/audit"
	contextbundle "kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/domain"
	manualplanner "kernl.local/harness/backend/internal/planner/manual"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/session"
)

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

	raw := []byte(`{"protocol":"harness.execution/v1","plan_id":"failed-plan","request_id":"` + originalRequest + `","status":"ready","summary":"test failure","risk":"low","requires_approval":false,"operations":[],"verification":[{"argv":["npm","run","build"],"cwd":".","timeout_seconds":30,"network":false,"expected_exit_codes":[0]}]}`)
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

	raw := []byte(`{"protocol":"harness.execution/v1","plan_id":"failed-plan","request_id":"` + originalRequest + `","status":"ready","summary":"test failure","risk":"low","requires_approval":false,"operations":[],"verification":[{"argv":["npm","run","build"],"cwd":".","timeout_seconds":30,"network":false,"expected_exit_codes":[0]}]}`)
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
