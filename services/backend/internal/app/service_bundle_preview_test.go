package app

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"kernl.local/harness/backend/internal/audit"
	"kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/planner/manual"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/sandbox"
	"kernl.local/harness/backend/internal/session"
)

func TestPreviewComposerBundleBuildsDisposableNextRequestWithoutAllocatingIt(t *testing.T) {
	project := t.TempDir()
	if err := os.WriteFile(filepath.Join(project, "main.txt"), []byte("hello"), 0o600); err != nil {
		t.Fatal(err)
	}
	store := session.NewStore()
	service := NewService(store, audit.NewBus(), contextbundle.NewBuilder(1<<20, 2<<20), manual.New(), policy.NewEngine(), sandbox.NewLocalRunner())
	objects := &memoryArtifactStore{objects: map[string][]byte{}}
	service.SetArtifactStore(objects, 30)
	started, err := service.StartSession(context.Background(), project)
	if err != nil {
		t.Fatal(err)
	}
	started, err = service.SetContextMode(started.ID, domain.ContextModeFull)
	if err != nil {
		t.Fatal(err)
	}

	record, err := service.PreviewComposerBundle(context.Background(), started.ID, ComposerBundlePreviewRequest{
		Message:      "implemente a mudança",
		PlanningMode: "direct",
		ProjectFiles: []string{"main.txt"},
		Attachments: []RemoteInputFile{{
			Name: "notes.txt", MIME: "text/plain", ContentBase64: base64.StdEncoding.EncodeToString([]byte("notes")),
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if record.Kind != "bundle-preview" || !record.Bundle || record.RequestID == "" {
		t.Fatalf("unexpected preview artifact: %#v", record)
	}
	after, err := service.GetSession(started.ID)
	if err != nil {
		t.Fatal(err)
	}
	if after.LastRequestID != started.LastRequestID || len(after.PendingManualRequestIDs) != len(started.PendingManualRequestIDs) {
		t.Fatalf("preview allocated a real request: before=%q/%v after=%q/%v", started.LastRequestID, started.PendingManualRequestIDs, after.LastRequestID, after.PendingManualRequestIDs)
	}
	if after.AttemptLedger != started.AttemptLedger || after.AutomationAttempt != started.AutomationAttempt || after.ImprovementAttempt != started.ImprovementAttempt {
		t.Fatal("preview mutated live attempt state")
	}

	entries, err := service.ArtifactEntries(context.Background(), started.ID, record.ID)
	if err != nil {
		t.Fatal(err)
	}
	paths := map[string]bool{}
	for _, entry := range entries {
		paths[entry.Path] = true
	}
	for _, expected := range []string{"transport.json", "prompt/wharness-planner-prompt.md", "context/main.txt", "references/project-files.json", "attachments/notes.txt", "attempts/state.json", "git-context/index.json"} {
		if !paths[expected] {
			t.Errorf("preview bundle missing %s", expected)
		}
	}

	raw, _, err := service.ReadArtifactEntry(context.Background(), started.ID, record.ID, "transport.json")
	if err != nil {
		t.Fatal(err)
	}
	var manifest struct {
		RequestID       string `json:"request_id"`
		ContextIncluded bool   `json:"context_included"`
	}
	if err := json.Unmarshal(raw, &manifest); err != nil {
		t.Fatal(err)
	}
	if manifest.RequestID != record.RequestID || !manifest.ContextIncluded {
		t.Fatalf("unexpected preview transport manifest: %#v", manifest)
	}
}
