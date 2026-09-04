package app

import (
	"archive/zip"
	"context"
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/audit"
	"kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/planner/manual"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/sandbox"
	"kernl.local/harness/backend/internal/session"
)

type capturingRemoteStore struct {
	objectName string
	entries    map[string]bool
}

func (s *capturingRemoteStore) Status() RemoteInputStatus {
	return RemoteInputStatus{Enabled: true, Provider: "capture", Mode: "remote_url"}
}

func (s *capturingRemoteStore) Publish(_ context.Context, object RemoteInputObject) (RemoteInputPublication, error) {
	s.objectName = object.ObjectName
	s.entries = map[string]bool{}
	archive, err := zip.OpenReader(object.FilePath)
	if err != nil {
		return RemoteInputPublication{}, err
	}
	defer archive.Close()
	for _, entry := range archive.File {
		s.entries[entry.Name] = true
	}
	return RemoteInputPublication{Provider: "capture", InstanceID: "capture-1", URL: "https://files.example/" + object.ObjectName}, nil
}

func TestBuildRemoteInputArchiveContainsPromptContextAndAttachments(t *testing.T) {
	root := t.TempDir()
	contextPath := filepath.Join(root, "context.zip")
	if err := os.WriteFile(contextPath, []byte("context-zip"), 0o600); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(root, "remote.zip")
	request := RemoteInputRequest{RequestID: "req_test", Prompt: "full prompt", IncludeContext: true}
	attachments, err := decodeRemoteFiles([]RemoteInputFile{{Name: "notes.txt", ContentBase64: base64.StdEncoding.EncodeToString([]byte("notes"))}}, maxRemoteAttachmentBytes)
	if err != nil {
		t.Fatal(err)
	}
	digest, size, err := buildRemoteInputArchive(target, contextPath, request, attachments, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(digest) != 64 || size <= 0 {
		t.Fatalf("invalid digest/size: %q %d", digest, size)
	}
	archive, err := zip.OpenReader(target)
	if err != nil {
		t.Fatal(err)
	}
	defer archive.Close()
	names := map[string]bool{}
	for _, entry := range archive.File {
		names[entry.Name] = true
	}
	for _, expected := range []string{"transport.json", "prompt/wharness-planner-prompt.md", "context/wharness-context.zip", "attachments/notes.txt"} {
		if !names[expected] {
			t.Errorf("missing %s", expected)
		}
	}
}

func TestPublishRemoteInputRequiresActiveRequestAndReturnsShortBootstrap(t *testing.T) {
	project := t.TempDir()
	if err := os.WriteFile(filepath.Join(project, "main.txt"), []byte("hello"), 0o600); err != nil {
		t.Fatal(err)
	}
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 2<<20), manual.New(), policy.NewEngine(), sandbox.NewLocalRunner())
	remote := &capturingRemoteStore{}
	service.SetRemoteInputStore(remote)
	started, err := service.StartSession(context.Background(), project)
	if err != nil {
		t.Fatal(err)
	}
	_, prompted, err := service.SubmitMessage(context.Background(), started.ID, "implement it")
	if err != nil {
		t.Fatal(err)
	}
	result, err := service.PublishRemoteInput(context.Background(), started.ID, RemoteInputRequest{RequestID: prompted.LastRequestID, Prompt: prompted.LastManualPrompt, IncludeContext: true})
	if err != nil {
		t.Fatal(err)
	}
	if result.Mode != "remote_url" || result.InstanceID != "capture-1" || !strings.Contains(result.BootstrapPrompt, "https://files.example/") || strings.Contains(result.BootstrapPrompt, prompted.LastManualPrompt) {
		t.Fatalf("unexpected bootstrap: %#v", result)
	}
	if !strings.HasPrefix(remote.objectName, "wharness-input-"+prompted.LastRequestID+"-") || !remote.entries["prompt/wharness-planner-prompt.md"] || !remote.entries["context/wharness-context.zip"] {
		t.Fatalf("unexpected remote archive: object=%q entries=%#v", remote.objectName, remote.entries)
	}
	if _, err := service.PublishRemoteInput(context.Background(), started.ID, RemoteInputRequest{RequestID: "req_wrong", Prompt: "prompt"}); err == nil {
		t.Fatal("expected inactive request id to be rejected")
	}
}
