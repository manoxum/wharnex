package executionbundle

import (
	"archive/zip"
	"bytes"
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

func TestParseRejectsTraversalAndMissingReadme(t *testing.T) {
	traversal := zipBytes(t, map[string]string{"../evil": "x", "plan.json": "{}", "README.md": "x"})
	if _, err := Parse("x.zip", traversal); err == nil {
		t.Fatal("expected traversal rejection")
	}
	missing := zipBytes(t, map[string]string{"plan.json": "{}"})
	if _, err := Parse("x.zip", missing); err == nil {
		t.Fatal("expected README rejection")
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
