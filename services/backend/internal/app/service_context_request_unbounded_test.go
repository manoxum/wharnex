package app

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/app/workflowbudget"
	"kernl.local/harness/backend/internal/audit"
	"kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/planner/manual"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/sandbox"
	"kernl.local/harness/backend/internal/session"
)

// The planner, not the engine, decides when it has read enough: increments
// beyond the old six-round ceiling are accepted and spend no workflow steps.
func TestPartialContextRequestHasNoIncrementRoundLimit(t *testing.T) {
	const increments = workflowbudget.OrdinaryLimit + 2
	project := t.TempDir()
	for i := 0; i < increments; i++ {
		if err := os.WriteFile(filepath.Join(project, fmt.Sprintf("file-%d.txt", i)), []byte("body"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 2<<20), manual.New(), policy.NewEngine(), sandbox.NewLocalRunner())
	started, err := service.StartSession(context.Background(), project)
	if err != nil {
		t.Fatal(err)
	}
	_, current, err := service.SubmitMessage(context.Background(), started.ID, "read every file")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(current.LastManualPrompt, "at most six increment") {
		t.Fatal("Partial prompt still advertises an increment ceiling")
	}
	for i := 0; i < increments; i++ {
		requestID := current.LastRequestID
		bundle := testArtifactZIP(t, map[string]string{
			"README.md":            "# More context",
			"turn.json":            `{"protocol":"harness.turn/v1","request_id":"` + requestID + `","kind":"context_request","message":"Preciso de mais.","context_paths":["context/file-` + fmt.Sprint(i) + `.txt"],"outcome":{"status":"completed","retryable":false}}`,
			"summary.md":           "Resumo cumulativo.\n\n## Conhecimento adquirido\nNenhum.",
			"knowledge/index.json": `{"protocol":"harness.knowledge/v2","base_revision":0,"mode":"replace","entries":[]}`,
		})
		submitted, err := service.SubmitExecutionBundle(context.Background(), started.ID, expectedResponseBundleFilename(current, requestID), bundle)
		if err != nil {
			t.Fatalf("increment %d rejected: %v", i+1, err)
		}
		if !submitted.ContextIncremented {
			t.Fatalf("increment %d not prepared: %#v", i+1, submitted)
		}
		current = submitted.Session
	}
	if current.ContextIncrements != increments || len(current.ContextPaths) != increments {
		t.Fatalf("increments=%d paths=%d", current.ContextIncrements, len(current.ContextPaths))
	}
	if used := workflowbudget.StepsUsed(current); used != 0 {
		t.Fatalf("context increments spent %d workflow steps", used)
	}
	if strings.Contains(current.LastManualPrompt, "FINAL WORKFLOW ROUND:") || !strings.Contains(current.LastManualPrompt, fmt.Sprintf("PARTIAL CONTEXT INCREMENT — round %d", increments)) {
		t.Fatal("increment continuation must report its round without a ceiling")
	}
}
