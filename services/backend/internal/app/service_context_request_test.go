package app

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
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
	"kernl.local/harness/backend/internal/session"
)

func TestPartialContextRequestAddsOnlyCapturedFilesToNextBundle(t *testing.T) {
	project := t.TempDir()
	for name, value := range map[string]string{"main.txt": "main body", "other.txt": "other body"} {
		if err := os.WriteFile(filepath.Join(project, name), []byte(value), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 2<<20), manual.New(), policy.NewEngine(), sandbox.NewLocalRunner())
	remote := &capturingRemoteStore{}
	service.SetRemoteInputStore(remote)
	started, err := service.StartSession(context.Background(), project)
	if err != nil {
		t.Fatal(err)
	}
	if started.ContextMode != domain.ContextModePartial {
		t.Fatalf("new sessions must default to Partial: %q", started.ContextMode)
	}
	_, first, err := service.SubmitMessage(context.Background(), started.ID, "read main")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(first.LastManualPrompt, "kind=\"context_request\"") {
		t.Fatal("Partial prompt omits increment instruction")
	}
	_, err = service.PublishRemoteInput(context.Background(), started.ID, RemoteInputRequest{RequestID: first.LastRequestID, Prompt: first.LastManualPrompt})
	if err != nil {
		t.Fatal(err)
	}
	_, entries, _ := remote.snapshot()
	if !entries["context-map/main/maps"] || entries["context/main.txt"] || entries["context/other.txt"] {
		t.Fatalf("initial Partial archive leaked file bodies: %#v", entries)
	}
	request := testArtifactZIP(t, map[string]string{
		"README.md":            "# More context\nRead the named file.",
		"turn.json":            `{"protocol":"harness.turn/v1","request_id":"` + first.LastRequestID + `","kind":"context_request","message":"Preciso de main.txt.","context_paths":["context/main.txt"],"outcome":{"status":"completed","retryable":false}}`,
		"summary.md":           "Resumo cumulativo.\n\n## Conhecimento adquirido\nNenhum.",
		"knowledge/index.json": `{"protocol":"harness.knowledge/v2","base_revision":0,"mode":"replace","entries":[]}`,
	})
	submitted, err := service.SubmitExecutionBundle(context.Background(), started.ID, expectedResponseBundleFilename(first, first.LastRequestID), request)
	if err != nil {
		t.Fatal(err)
	}
	if !submitted.WorkflowPrepared || !submitted.ContextIncremented || submitted.Session.LastRequestID == first.LastRequestID {
		t.Fatalf("context continuation not prepared: %#v", submitted)
	}
	if recorded := ledgerEvents(service.bus.History(started.ID), EventExecutionRecorded); len(recorded) != 1 || recorded[0].Data["request_id"] != first.LastRequestID {
		t.Fatalf("the increment round must reach the durable ledger: %#v", recorded)
	}
	_, err = service.PublishRemoteInput(context.Background(), started.ID, RemoteInputRequest{RequestID: submitted.Session.LastRequestID, Prompt: submitted.Session.LastManualPrompt})
	if err != nil {
		t.Fatal(err)
	}
	_, entries, _ = remote.snapshot()
	if !entries["context/main.txt"] || entries["context/other.txt"] {
		t.Fatalf("increment archive selection incorrect: %#v", entries)
	}
	if _, err := selectContextPaths(submitted.Session.Context.ZipPath, nil, []string{"context/../other.txt"}); err == nil {
		t.Fatal("traversal must be rejected")
	}
}

func TestPartialContextRequestCarriesMoreThan128SelectedFilesIntoNextBundle(t *testing.T) {
	project := t.TempDir()
	requested := make([]string, 150)
	for i := range requested {
		name := fmt.Sprintf("file-%03d.txt", i)
		if err := os.WriteFile(filepath.Join(project, name), []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
		requested[i] = "context/" + name
	}
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 2<<20), manual.New(), policy.NewEngine(), sandbox.NewLocalRunner())
	remote := &capturingRemoteStore{}
	service.SetRemoteInputStore(remote)
	started, err := service.StartSession(context.Background(), project)
	if err != nil {
		t.Fatal(err)
	}
	_, first, err := service.SubmitMessage(context.Background(), started.ID, "inspect the captured files")
	if err != nil {
		t.Fatal(err)
	}
	turnRaw, err := json.Marshal(domain.AgentTurn{
		Protocol:     domain.TurnProtocolV1,
		RequestID:    first.LastRequestID,
		Kind:         domain.TurnKindContextRequest,
		Message:      "Need the complete captured set.",
		ContextPaths: requested,
		Outcome:      &domain.TurnOutcome{Status: domain.TurnOutcomeCompleted},
	})
	if err != nil {
		t.Fatal(err)
	}
	request := testArtifactZIP(t, map[string]string{
		"README.md":            "# More context\nRead the complete captured set.",
		"turn.json":            string(turnRaw),
		"summary.md":           "Resumo cumulativo.\n\n## Conhecimento adquirido\nNenhum.",
		"knowledge/index.json": `{"protocol":"harness.knowledge/v2","base_revision":0,"mode":"replace","entries":[]}`,
	})
	submitted, err := service.SubmitExecutionBundle(context.Background(), started.ID, expectedResponseBundleFilename(first, first.LastRequestID), request)
	if err != nil {
		t.Fatal(err)
	}
	if len(submitted.Session.ContextPaths) != len(requested) {
		t.Fatalf("selected %d paths, want %d", len(submitted.Session.ContextPaths), len(requested))
	}
	_, err = service.PublishRemoteInput(context.Background(), started.ID, RemoteInputRequest{RequestID: submitted.Session.LastRequestID, Prompt: submitted.Session.LastManualPrompt})
	if err != nil {
		t.Fatal(err)
	}
	_, entries, _ := remote.snapshot()
	for _, path := range requested {
		if !entries[path] {
			t.Fatalf("next Partial bundle omitted selected path %q", path)
		}
	}
}

func TestSelectContextPathsIsByteBoundedNotCountBounded(t *testing.T) {
	archivePath := filepath.Join(t.TempDir(), "context.zip")
	file, err := os.Create(archivePath)
	if err != nil {
		t.Fatal(err)
	}
	writer := zip.NewWriter(file)
	requested := make([]string, 150)
	for i := range requested {
		name := fmt.Sprintf("file-%03d.txt", i)
		requested[i] = requestPrimaryContextRoot + name
		entry, createErr := writer.Create(name)
		if createErr != nil {
			t.Fatal(createErr)
		}
		if _, writeErr := entry.Write([]byte("x")); writeErr != nil {
			t.Fatal(writeErr)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	selected, err := selectContextPaths(archivePath, nil, requested)
	if err != nil {
		t.Fatalf("150 small files should fit the byte budget: %v", err)
	}
	if len(selected) != len(requested) {
		t.Fatalf("selected %d paths, want %d", len(selected), len(requested))
	}
}

func TestSelectContextPathsStillRejectsSelectionsAboveByteBudget(t *testing.T) {
	archivePath := filepath.Join(t.TempDir(), "context.zip")
	file, err := os.Create(archivePath)
	if err != nil {
		t.Fatal(err)
	}
	writer := zip.NewWriter(file)
	entry, err := writer.Create("huge.txt")
	if err != nil {
		t.Fatal(err)
	}
	chunk := bytes.Repeat([]byte{'x'}, 1<<20)
	for i := 0; i < 65; i++ {
		if _, err := entry.Write(chunk); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := selectContextPaths(archivePath, nil, []string{"context/huge.txt"}); err == nil || !strings.Contains(err.Error(), "67108864 bytes") {
		t.Fatalf("selection above 64 MiB must be rejected by bytes, got %v", err)
	}
}
