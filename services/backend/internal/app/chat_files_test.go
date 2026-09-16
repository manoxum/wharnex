package app

import (
	"context"
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

func TestChatFilesIncludeAttachmentsAndReturnedFilesWithoutTransportDuplicates(t *testing.T) {
	store := session.NewStore()
	if err := store.Put(domain.Session{ID: "ses_files", ProjectPath: t.TempDir(), CreatedAt: time.Now().UTC()}); err != nil {
		t.Fatal(err)
	}
	service := NewService(store, audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), sandbox.NewLocalRunner())
	objects := &memoryArtifactStore{objects: map[string][]byte{}}
	service.SetArtifactStore(objects, 30)

	attachment := []byte("hello")
	if _, err := service.PersistArtifact(context.Background(), "ses_files", "req_files", "input", "attachment", "hello.txt", "text/plain", attachment); err != nil {
		t.Fatal(err)
	}
	if _, err := service.PersistArtifact(context.Background(), "ses_files", "req_files", "input", "bundle", "request.zip", "application/zip", testArtifactZIP(t, map[string]string{
		"attachments/hello.txt":                  "hello",
		"attachments/wharnex-execution-error.md": "operational",
		"prompt/request.md":                      "request",
	})); err != nil {
		t.Fatal(err)
	}
	response, err := service.PersistArtifact(context.Background(), "ses_files", "req_files", "output", "bundle", "response.zip", "application/zip", testArtifactZIP(t, map[string]string{
		"artifacts/report.md":                   "# report",
		"artifacts/wharnex-execution-result.md": "operational",
		"metadata/artifact-presentation.json":   `{"protocol":"harness.artifact-presentation/v1","galleries":[{"id":"docs","items":[{"path":"artifacts/report.md"}]}]}`,
		"turn.json":                             `{"kind":"change"}`,
	}))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.PersistArtifact(context.Background(), "ses_files", "library", "input", "library", "hidden.txt", "text/plain", []byte("hidden")); err != nil {
		t.Fatal(err)
	}

	files, err := service.ListChatFiles(context.Background(), "ses_files")
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 2 {
		t.Fatalf("expected direct attachment plus gallery-declared markdown, got %#v", files)
	}
	var attachmentFile, returnedFile *ChatFile
	for i := range files {
		switch files[i].Name {
		case "hello.txt":
			attachmentFile = &files[i]
		case "report.md":
			returnedFile = &files[i]
		}
	}
	if attachmentFile == nil || !attachmentFile.Direct || attachmentFile.Source != "attachment" {
		t.Fatalf("attachment should prefer direct record: %#v", attachmentFile)
	}
	if returnedFile == nil || returnedFile.Direct || returnedFile.Path != "artifacts/report.md" || returnedFile.Source != "returned" {
		t.Fatalf("returned bundle entry missing: %#v", returnedFile)
	}

	for _, file := range files {
		if file.Name == "wharnex-execution-error.md" || file.Name == "wharnex-execution-result.md" {
			t.Fatalf("operational markdown must stay out of chat files unless declared by the output gallery: %#v", file)
		}
	}
	if _, err := service.SaveChatFileToLibrary(context.Background(), "ses_files", response.ID, "artifacts/wharnex-execution-result.md"); err == nil {
		t.Fatal("hidden operational markdown must not be saveable through the chat-files endpoint")
	}

	saved, err := service.SaveChatFileToLibrary(context.Background(), "ses_files", response.ID, "artifacts/report.md")
	if err != nil {
		t.Fatal(err)
	}
	if saved.Kind != "library" || saved.Name != "report.md" || !saved.ExpiresAt.IsZero() {
		t.Fatalf("unexpected durable library record: %#v", saved)
	}
	library := service.ListManagedArtifactsByKind("", false, "library")
	if len(library) != 2 {
		t.Fatalf("expected both library records in catalog, got %#v", library)
	}
	if err := service.CleanupArtifacts(context.Background(), time.Now().UTC().Add(60*24*time.Hour)); err != nil {
		t.Fatal(err)
	}
	if libraryAfterCleanup := service.ListManagedArtifactsByKind("", false, "library"); len(libraryAfterCleanup) != 2 {
		t.Fatalf("library records must survive retention cleanup: %#v", libraryAfterCleanup)
	}
}
