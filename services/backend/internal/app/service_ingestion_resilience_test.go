package app

import (
	"archive/zip"
	"bytes"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/audit"
	contextbundle "kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/domain"
	manualplanner "kernl.local/harness/backend/internal/planner/manual"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/sandbox"
	"kernl.local/harness/backend/internal/session"
)

// These tests cover the rule that an auxiliary defect in a response bundle
// must never destroy the executable payload that travelled with it. Every
// case below was observed in production discarding a complete, valid change.

func bundleWithEntries(t *testing.T, entries map[string]string) []byte {
	t.Helper()
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

// changeBundleWithKnowledge builds a normal change bundle whose knowledge
// candidate declares baseRevision, letting a test simulate a peer chat having
// advanced the catalog while this request was in flight.
func changeBundleWithKnowledge(t *testing.T, requestID string, baseRevision int, timeoutSeconds int) []byte {
	t.Helper()
	return bundleWithEntries(t, map[string]string{
		"README.md":            "# Automatic fix\nChanges hello.txt from old to new.\n",
		"patches/001.patch":    "--- a/hello.txt\n+++ b/hello.txt\n@@ -1 +1 @@\n-old\n+new\n",
		"summary.md":           "Resumo cumulativo do pedido de teste.",
		"knowledge/index.json": `{"protocol":"harness.knowledge/v2","base_revision":` + itoa(baseRevision) + `,"mode":"replace","entries":[]}`,
		"plan.json": `{"protocol":"harness.execution/v1","plan_id":"bundle-plan","request_id":"` + requestID +
			`","status":"ready","summary":"Replace the hello greeting text in the demo file","risk":"low","commit_message":"fix(demo): replace the hello greeting text","requires_approval":false,` +
			`"operations":[{"type":"apply_patch","patch_file":"patches/001.patch","command":{"argv":[],"cwd":".","timeout_seconds":60,"network":false,"expected_exit_codes":[0]}}],` +
			`"verification":[{"argv":["go","test","./..."],"cwd":".","timeout_seconds":` + itoa(timeoutSeconds) + `,"network":false,"expected_exit_codes":[0]}]}`,
	})
}

func itoa(value int) string {
	if value == 0 {
		return "0"
	}
	digits := ""
	negative := value < 0
	if negative {
		value = -value
	}
	for value > 0 {
		digits = string(rune('0'+value%10)) + digits
		value /= 10
	}
	if negative {
		return "-" + digits
	}
	return digits
}

func startBundleSession(t *testing.T) (*Service, domain.Session, string) {
	t.Helper()
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "hello.txt"), []byte("old\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	started, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeManual)
	if err != nil {
		t.Fatal(err)
	}
	_, prompted, err := service.SubmitMessage(context.Background(), started.ID, "change hello")
	if err != nil {
		t.Fatal(err)
	}
	return service, prompted, prompted.LastRequestID
}

// A peer chat committing knowledge mid-flight used to reject the entire
// bundle with "stage response knowledge: knowledge candidate base_revision N
// does not match request revision M", throwing away a verified change over
// catalog bookkeeping.
func TestKnowledgeRevisionDriftDoesNotDiscardTheChangeBundle(t *testing.T) {
	service, started, requestID := startBundleSession(t)
	raw := changeBundleWithKnowledge(t, requestID, 99, 60)

	submission, err := service.SubmitExecutionBundle(context.Background(), started.ID, "whx_bundle_res_system_"+requestID+".zip", raw)
	if err != nil {
		t.Fatalf("catalog drift must not reject the bundle: %v", err)
	}
	if submission.Session.Plan == nil || submission.Session.Plan.PlanID != "bundle-plan" {
		t.Fatalf("the executable plan must survive knowledge drift: %#v", submission.Session.Plan)
	}
	if submission.Session.PendingKnowledgeCandidate != nil {
		t.Fatal("a stale replace candidate must not be staged")
	}
	if !hasEvent(service, started.ID, "knowledge.stage_skipped", "concurrent_catalog_revision") {
		t.Fatal("the skip must be reported as catalog concurrency, not as a protocol defect")
	}
}

// A knowledge payload that is structurally wrong is still auxiliary: the plan
// must survive, but the skip must be reported as a payload problem so it is
// distinguishable from routine catalog drift.
func TestMalformedKnowledgePayloadDoesNotDiscardTheChangeBundle(t *testing.T) {
	service, started, requestID := startBundleSession(t)
	raw := bundleWithEntries(t, map[string]string{
		"README.md":         "# Automatic fix\n",
		"patches/001.patch": "--- a/hello.txt\n+++ b/hello.txt\n@@ -1 +1 @@\n-old\n+new\n",
		"plan.json": `{"protocol":"harness.execution/v1","plan_id":"bundle-plan","request_id":"` + requestID +
			`","status":"ready","summary":"Replace the hello greeting text in the demo file","risk":"low","commit_message":"fix(demo): replace the hello greeting text","requires_approval":false,` +
			`"operations":[{"type":"apply_patch","patch_file":"patches/001.patch","command":{"argv":[],"cwd":".","timeout_seconds":60,"network":false,"expected_exit_codes":[0]}}],"verification":[]}`,
	})

	submission, err := service.SubmitExecutionBundle(context.Background(), started.ID, "whx_bundle_res_system_"+requestID+".zip", raw)
	if err != nil {
		t.Fatalf("a missing knowledge index must not reject the bundle: %v", err)
	}
	if submission.Session.Plan == nil {
		t.Fatal("the executable plan must survive a malformed knowledge payload")
	}
	if !hasEvent(service, started.ID, "knowledge.stage_skipped", "invalid_knowledge_payload") {
		t.Fatal("a malformed payload must be reported distinctly from catalog drift")
	}
}

// An out-of-range timeout is a transport mistake, not a reason to lose the
// patch. It must be clamped, reported, and the plan accepted.
func TestOutOfRangeVerificationTimeoutIsNormalizedInsteadOfRejecting(t *testing.T) {
	service, started, requestID := startBundleSession(t)
	raw := changeBundleWithKnowledge(t, requestID, 0, 7200)

	submission, err := service.SubmitExecutionBundle(context.Background(), started.ID, "whx_bundle_res_system_"+requestID+".zip", raw)
	if err != nil {
		t.Fatalf("an over-ceiling timeout must be clamped, not rejected: %v", err)
	}
	plan := submission.Session.Plan
	if plan == nil || len(plan.Verification) != 1 {
		t.Fatalf("the plan must survive normalization: %#v", plan)
	}
	if plan.Verification[0].TimeoutSeconds != 1800 {
		t.Fatalf("timeout = %d, want it clamped to 1800", plan.Verification[0].TimeoutSeconds)
	}
	if !hasEvent(service, started.ID, "plan.budgets_normalized", "clamped") {
		t.Fatal("the adjustment must be recorded rather than applied silently")
	}
}

func hasEvent(service *Service, sessionID, eventType, contains string) bool {
	for _, event := range service.bus.History(sessionID) {
		if event.Type != eventType {
			continue
		}
		if contains == "" {
			return true
		}
		for _, value := range event.Data {
			if text, ok := value.(string); ok && strings.Contains(text, contains) {
				return true
			}
			if list, ok := value.([]string); ok {
				for _, item := range list {
					if strings.Contains(item, contains) {
						return true
					}
				}
			}
		}
	}
	return false
}

// diskFullRunner reproduces the production failure exactly: the patch applies,
// then a verification command fails with the linker's device-full error.
type diskFullRunner struct{ fakeRunner }

func (r diskFullRunner) Run(_ context.Context, _ sandbox.Workspace, c domain.CommandSpec) (domain.CommandResult, error) {
	if len(c.Argv) > 1 && c.Argv[0] == "go" && c.Argv[1] == "test" {
		return domain.CommandResult{
			Argv: c.Argv, Cwd: c.Cwd, ExitCode: 1, Success: false,
			Stdout: "/usr/local/go/pkg/tool/linux_amd64/link: mapping output file failed: no space left on device\nFAIL\n",
		}, nil
	}
	return domain.CommandResult{Argv: c.Argv, Cwd: c.Cwd, ExitCode: 0, Success: true}, nil
}

func (r diskFullRunner) RunStreaming(ctx context.Context, workspace sandbox.Workspace, c domain.CommandSpec, _ sandbox.StreamCallback) (domain.CommandResult, error) {
	return r.Run(ctx, workspace, c)
}

// A machine running out of disk is an infrastructure fault: it must be
// classified, and it must NOT enter the bounded ChatGPT repair loop, which
// provably cannot fix it — the retry fails identically and burns an attempt.
func TestSandboxDiskExhaustionIsClassifiedAndSkipsTheRepairLoop(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "hello.txt"), []byte("old\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), diskFullRunner{})
	started, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeManual)
	if err != nil {
		t.Fatal(err)
	}
	_, prompted, err := service.SubmitMessage(context.Background(), started.ID, "change hello")
	if err != nil {
		t.Fatal(err)
	}
	requestID := prompted.LastRequestID
	// The failing command is a plan OPERATION, not a verification step: a
	// verification failure that reproduces identically on the unpatched
	// baseline is (correctly) absorbed as pre-existing, and a fake runner
	// cannot distinguish the two workspaces. The classification under test is
	// the same either way.
	raw := bundleWithEntries(t, map[string]string{
		"README.md":            "# Automatic fix\n",
		"patches/001.patch":    "--- a/hello.txt\n+++ b/hello.txt\n@@ -1 +1 @@\n-old\n+new\n",
		"summary.md":           "Resumo cumulativo do pedido de teste.",
		"knowledge/index.json": `{"protocol":"harness.knowledge/v2","base_revision":0,"mode":"replace","entries":[]}`,
		"plan.json": `{"protocol":"harness.execution/v1","plan_id":"bundle-plan","request_id":"` + requestID +
			`","status":"ready","summary":"Replace the hello greeting text in the demo file","risk":"low","commit_message":"fix(demo): replace the hello greeting text","requires_approval":false,` +
			`"operations":[{"type":"apply_patch","patch_file":"patches/001.patch","command":{"argv":[],"cwd":".","timeout_seconds":60,"network":false,"expected_exit_codes":[0]}},` +
			`{"type":"command","patch":"","command":{"argv":["go","test","./..."],"cwd":".","timeout_seconds":600,"network":false,"expected_exit_codes":[0]}}],"verification":[]}`,
	})
	if _, err := service.SubmitExecutionBundle(context.Background(), started.ID, "whx_bundle_res_system_"+requestID+".zip", raw); err != nil {
		t.Fatal(err)
	}
	_, updated, execErr := service.Execute(context.Background(), started.ID, true)
	if execErr == nil {
		t.Fatal("the disk-full verification must fail the execution")
	}
	if updated.FailureKind != domain.FailureKindSandboxResourceExhausted {
		t.Fatalf("failure_kind = %q, want %q", updated.FailureKind, domain.FailureKindSandboxResourceExhausted)
	}
	if updated.State == "repair_pending" {
		t.Fatal("an infrastructure fault must never enter the ChatGPT repair loop")
	}
	if !hasEvent(service, started.ID, "sandbox.resource_exhausted", "no space left on device") {
		t.Fatal("the operator must see which command exhausted the machine")
	}
}
