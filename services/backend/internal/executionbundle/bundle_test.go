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
		"turn.json": `{"protocol":"harness.turn/v1","request_id":"req_12345678","kind":"change","message":"Atualizar."}`,
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
		"turn.json": `{"protocol":"harness.turn/v1","request_id":"req_12345678","kind":"answer","message":"A série limita a consulta aos últimos 12 registos mensais."}`,
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

func TestParseChangeTurnRequiresMatchingPlan(t *testing.T) {
	entries := map[string]string{
		"README.md": "# Change\n",
		"turn.json": `{"protocol":"harness.turn/v1","request_id":"req_12345678","kind":"change","message":"Atualizar o ficheiro."}`,
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
		"turn.json": `{"protocol":"harness.turn/v1","request_id":"req_12345678","kind":"answer","message":"Resposta útil."}`,
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
		"result/turn.json": `{"protocol":"harness.turn/v1","request_id":"req_12345678","kind":"change","message":"Aplicar alteração."}`,
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
		"turn.json": `{"protocol":"harness.turn/v1","request_id":"req_12345678","kind":"workflow","message":"Vou confirmar um detalhe local antes de responder."}`,
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
		"turn.json": `{"protocol":"harness.turn/v1","request_id":"req_12345678","kind":"workflow","message":"Preciso de evidência local."}`,
	})
	if _, err := Parse("wharness-bundle-req_12345678.zip", raw); err == nil {
		t.Fatal("expected workflow plan requirement")
	}
}
