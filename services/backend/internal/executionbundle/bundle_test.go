package executionbundle

import (
	"archive/zip"
	"bytes"
	"slices"
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/domain"
)

func zipBytes(t *testing.T, entries map[string]string) []byte {
	t.Helper()
	var out bytes.Buffer
	w := zip.NewWriter(&out)
	for name, value := range entries {
		f, err := w.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := f.Write([]byte(value)); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}

func TestParseResolvesPatchFile(t *testing.T) {
	raw := zipBytes(t, map[string]string{
		"README.md":         "# Fix\n",
		"patches/":          "",
		"patches/001.patch": "--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-a\n+b\n",
		"plan.json":         `{"protocol":"harness.execution/v1","plan_id":"p1","request_id":"req_12345678","status":"ready","summary":"fix","risk":"low","requires_approval":false,"operations":[{"type":"apply_patch","patch_file":"patches/001.patch","command":{"argv":[],"cwd":".","timeout_seconds":60,"network":false,"expected_exit_codes":[0]}}],"verification":[]}`,
	})
	parsed, err := Parse("wharness-bundle-req_12345678.zip", raw)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Plan.Operations[0].Patch == "" || len(parsed.Info.Patches) != 1 {
		t.Fatalf("unexpected parsed bundle: %#v", parsed)
	}
}

func TestParsePreservesBaselineConcurrencyMetadata(t *testing.T) {
	raw := zipBytes(t, map[string]string{
		"README.md": "# Fix\n",
		"turn.json": `{"protocol":"harness.turn/v1","request_id":"req_12345678","kind":"change","message":"Atualizar.","outcome":{"status":"completed","retryable":false}}`,
		"plan.json": `{"protocol":"harness.execution/v1","base_context_sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","impact_files":["services/backend/a.go"],"plan_id":"p1","request_id":"req_12345678","status":"ready","summary":"fix","risk":"low","requires_approval":false,"operations":[],"verification":[]}`,
	})
	parsed, err := Parse("wharness-bundle-req_12345678.zip", raw)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Plan == nil || parsed.Plan.BaseContextSHA256 == "" || !slices.Equal(parsed.Plan.ImpactFiles, []string{"services/backend/a.go"}) {
		t.Fatalf("missing concurrency metadata: %#v", parsed.Plan)
	}
}

func TestParseRejectsTraversalAndMissingStructuredContent(t *testing.T) {
	traversal := zipBytes(t, map[string]string{"../evil": "x", "plan.json": "{}", "README.md": "x"})
	if _, err := Parse("x.zip", traversal); err == nil {
		t.Fatal("expected traversal rejection")
	}
	missing := zipBytes(t, map[string]string{"README.md": "only docs"})
	if _, err := Parse("x.zip", missing); err == nil {
		t.Fatal("expected structured turn/plan rejection")
	}
}

func TestParseAnswerTurnWithoutExecutionPlan(t *testing.T) {
	raw := zipBytes(t, map[string]string{
		"README.md": "# Answer\n",
		"turn.json": `{"protocol":"harness.turn/v1","request_id":"req_12345678","kind":"answer","message":"A série limita a consulta aos últimos 12 registos mensais.","outcome":{"status":"completed","retryable":false}}`,
	})
	parsed, err := Parse("wharness-bundle-req_12345678.zip", raw)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Plan != nil {
		t.Fatalf("answer turn must not contain an execution plan: %#v", parsed.Plan)
	}
	if parsed.Turn.Kind != domain.TurnKindAnswer || parsed.Turn.Message == "" {
		t.Fatalf("unexpected answer turn: %#v", parsed.Turn)
	}
}

func TestParseExposesOptionalKnowledgeFileAtRoot(t *testing.T) {
	raw := zipBytes(t, map[string]string{
		"README.md":    "# Knowledge review\n",
		"turn.json":    `{"protocol":"harness.turn/v1","request_id":"req_12345678","kind":"answer","message":"Sem alterações necessárias.","outcome":{"status":"completed","retryable":false}}`,
		"knowledge.md": "# Wharness knowledge\n\n- Node do host tem de ser >=22.12 para o Electron fixado.\n",
	})
	parsed, err := Parse("wharness-bundle-req_12345678.zip", raw)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Info.ProjectKnowledgeUpdate == "" || !strings.Contains(parsed.Info.ProjectKnowledgeUpdate, "Electron fixado") {
		t.Fatalf("expected knowledge.md content to be exposed, got %q", parsed.Info.ProjectKnowledgeUpdate)
	}
}

func TestParseLeavesProjectKnowledgeUpdateEmptyWhenAbsent(t *testing.T) {
	raw := zipBytes(t, map[string]string{
		"README.md": "# Answer\n",
		"turn.json": `{"protocol":"harness.turn/v1","request_id":"req_12345678","kind":"answer","message":"Ok.","outcome":{"status":"completed","retryable":false}}`,
	})
	parsed, err := Parse("wharness-bundle-req_12345678.zip", raw)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Info.ProjectKnowledgeUpdate != "" {
		t.Fatalf("expected no knowledge update, got %q", parsed.Info.ProjectKnowledgeUpdate)
	}
}

func TestParseRejectsOversizedKnowledgeFile(t *testing.T) {
	raw := zipBytes(t, map[string]string{
		"README.md":    "# Answer\n",
		"turn.json":    `{"protocol":"harness.turn/v1","request_id":"req_12345678","kind":"answer","message":"Ok.","outcome":{"status":"completed","retryable":false}}`,
		"knowledge.md": strings.Repeat("x", maxKnowledgeBytes+1),
	})
	if _, err := Parse("wharness-bundle-req_12345678.zip", raw); err == nil || !strings.Contains(err.Error(), "256 KiB") {
		t.Fatalf("expected oversized knowledge.md rejection, got %v", err)
	}
}

func TestParseRejectsMissingOutcomeAndPlanOnFailedOutcome(t *testing.T) {
	missing := zipBytes(t, map[string]string{
		"README.md": "# Answer\n",
		"turn.json": `{"protocol":"harness.turn/v1","request_id":"req_12345678","kind":"answer","message":"Resposta útil."}`,
	})
	if _, err := Parse("wharness-bundle-req_12345678.zip", missing); err == nil || !strings.Contains(err.Error(), "outcome is required") {
		t.Fatalf("expected missing outcome rejection, got %v", err)
	}
	failedWithPlan := zipBytes(t, map[string]string{
		"README.md": "# Failed\n",
		"turn.json": `{"protocol":"harness.turn/v1","request_id":"req_12345678","kind":"change","message":"Não concluído.","outcome":{"status":"failed","message":"A ferramenta falhou.","retryable":true}}`,
		"plan.json": `{"protocol":"harness.execution/v1","plan_id":"p1","request_id":"req_12345678","status":"ready","summary":"fix","risk":"low","requires_approval":false,"operations":[],"verification":[]}`,
	})
	if _, err := Parse("wharness-bundle-req_12345678.zip", failedWithPlan); err == nil || !strings.Contains(err.Error(), "must not contain plan.json") {
		t.Fatalf("expected failed outcome plan rejection, got %v", err)
	}
}

func TestParseAcceptsFailedChangeOutcomeWithoutExecutionPlan(t *testing.T) {
	raw := zipBytes(t, map[string]string{
		"README.md": "# Failed\n",
		"turn.json": `{"protocol":"harness.turn/v1","request_id":"req_12345678","kind":"change","message":"Não foi possível produzir a alteração.","outcome":{"status":"failed","reason_code":"tool_error","message":"A ferramenta de edição falhou.","retryable":true}}`,
	})
	parsed, err := Parse("wharness-bundle-req_12345678.zip", raw)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Plan != nil || parsed.Turn.Outcome == nil || parsed.Turn.Outcome.Status != domain.TurnOutcomeFailed {
		t.Fatalf("unexpected failed turn: %#v", parsed)
	}
}

func TestParseChangeTurnRequiresMatchingPlan(t *testing.T) {
	entries := map[string]string{
		"README.md": "# Change\n",
		"turn.json": `{"protocol":"harness.turn/v1","request_id":"req_12345678","kind":"change","message":"Atualizar o ficheiro.","outcome":{"status":"completed","retryable":false}}`,
		"plan.json": `{"protocol":"harness.execution/v1","plan_id":"p1","request_id":"req_other999","status":"ready","summary":"fix","risk":"low","requires_approval":false,"operations":[],"verification":[]}`,
	}
	if _, err := Parse("wharness-bundle-req_12345678.zip", zipBytes(t, entries)); err == nil {
		t.Fatal("expected turn/plan request correlation rejection")
	}
	entries["plan.json"] = `{"protocol":"harness.execution/v1","plan_id":"p1","request_id":"req_12345678","status":"ready","summary":"fix","risk":"low","requires_approval":false,"operations":[],"verification":[]}`
	parsed, err := Parse("wharness-bundle-req_12345678.zip", zipBytes(t, entries))
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Plan == nil || parsed.Turn.Kind != domain.TurnKindChange {
		t.Fatalf("unexpected change turn: %#v", parsed)
	}
}

func TestParseSynthesizesMissingReadmeFromStructuredTurn(t *testing.T) {
	raw := zipBytes(t, map[string]string{
		"turn.json": `{"protocol":"harness.turn/v1","request_id":"req_12345678","kind":"answer","message":"Resposta útil.","outcome":{"status":"completed","retryable":false}}`,
	})
	parsed, err := Parse("wharness-bundle-req_12345678.zip", raw)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(parsed.Info.README, "synthesized by Wharness") || !strings.Contains(parsed.Info.README, "Resposta útil") {
		t.Fatalf("unexpected synthesized README: %q", parsed.Info.README)
	}
	if !slices.Contains(parsed.Info.Files, "README.md") {
		t.Fatalf("normalized file list must expose README.md: %#v", parsed.Info.Files)
	}
}

func TestParseNormalizesSingleWrapperDirectoryAndRootPatch(t *testing.T) {
	raw := zipBytes(t, map[string]string{
		"result/turn.json": `{"protocol":"harness.turn/v1","request_id":"req_12345678","kind":"change","message":"Aplicar alteração.","outcome":{"status":"completed","retryable":false}}`,
		"result/plan.json": `{"protocol":"harness.execution/v1","plan_id":"p1","request_id":"req_12345678","status":"ready","summary":"fix","risk":"low","requires_approval":false,"operations":[{"type":"apply_patch","patch_file":"001.patch","command":{"argv":[],"cwd":".","timeout_seconds":60,"network":false,"expected_exit_codes":[0]}}],"verification":[]}`,
		"result/README.md": "# Fix\n",
		"result/001.patch": "--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-a\n+b\n",
	})
	parsed, err := Parse("wharness-bundle-req_12345678.zip", raw)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Plan == nil || parsed.Plan.Operations[0].Patch == "" {
		t.Fatalf("wrapper/root patch normalization failed: %#v", parsed)
	}
	if !slices.Contains(parsed.Info.Patches, "patches/001.patch") {
		t.Fatalf("expected canonical patch path: %#v", parsed.Info.Patches)
	}
}

func TestParseWorkflowTurnWithCommandPlan(t *testing.T) {
	raw := zipBytes(t, map[string]string{
		"README.md": "# Workflow\nInspect local evidence.\n",
		"turn.json": `{"protocol":"harness.turn/v1","request_id":"req_12345678","kind":"workflow","message":"Vou confirmar um detalhe local antes de responder.","outcome":{"status":"completed","retryable":false}}`,
		"plan.json": `{"protocol":"harness.execution/v1","plan_id":"wf1","request_id":"req_12345678","status":"ready","summary":"inspect status","risk":"low","requires_approval":false,"operations":[{"type":"command","patch":"","command":{"argv":["git","status","--short"],"cwd":".","timeout_seconds":30,"network":false,"expected_exit_codes":[0]}}],"verification":[]}`,
	})
	parsed, err := Parse("wharness-bundle-req_12345678.zip", raw)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Plan == nil || parsed.Turn.Kind != domain.TurnKindWorkflow {
		t.Fatalf("unexpected workflow bundle: %#v", parsed)
	}
}

func TestParseWorkflowTurnRequiresPlan(t *testing.T) {
	raw := zipBytes(t, map[string]string{
		"README.md": "# Workflow\n",
		"turn.json": `{"protocol":"harness.turn/v1","request_id":"req_12345678","kind":"workflow","message":"Preciso de evidência local.","outcome":{"status":"completed","retryable":false}}`,
	})
	if _, err := Parse("wharness-bundle-req_12345678.zip", raw); err == nil {
		t.Fatal("expected workflow plan requirement")
	}
}
