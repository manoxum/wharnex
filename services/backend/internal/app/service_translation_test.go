package app

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"kernl.local/harness/backend/internal/audit"
	contextbundle "kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/domain"
	manualplanner "kernl.local/harness/backend/internal/planner/manual"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/sandbox"
	"kernl.local/harness/backend/internal/session"
	"kernl.local/harness/backend/internal/translation"
	"kernl.local/harness/backend/internal/utility"
)

// translationResponse packages what a well-behaved provider would return, so a
// test can vary exactly one field at a time and see what the engine refuses.
func translationResponse(t *testing.T, manifest translation.ResultManifest, document string) []byte {
	t.Helper()
	encoded, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	buffer := &bytes.Buffer{}
	archive := zip.NewWriter(buffer)
	for name, data := range map[string][]byte{
		translation.ResultManifestPath: encoded,
		translation.ResultPath:         []byte(document),
	} {
		writer, createErr := archive.Create(name)
		if createErr != nil {
			t.Fatal(createErr)
		}
		if _, writeErr := writer.Write(data); writeErr != nil {
			t.Fatal(writeErr)
		}
	}
	if err := archive.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func translationService(t *testing.T) (*Service, *session.Store) {
	t.Helper()
	store := session.NewStore()
	if err := store.Put(domain.Session{ID: "ses_translation", State: "ready"}); err != nil {
		t.Fatal(err)
	}
	return NewService(store, audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), sandbox.NewLocalRunner()), store
}

// awaitTranslationTask waits for the enqueued worker task and returns it with
// its decoded payload.
func awaitTranslationTask(t *testing.T, store *session.Store) (session.ChatAgentTask, translationWorkerPayload) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		items, err := store.ListChatAgentTasks(session.ChatAgentTaskFilter{ActiveOnly: true})
		if err != nil {
			t.Fatal(err)
		}
		if len(items) > 0 {
			var payload translationWorkerPayload
			if err := json.Unmarshal(items[0].Payload, &payload); err != nil {
				t.Fatal(err)
			}
			return items[0], payload
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("translation task was not enqueued")
	return session.ChatAgentTask{}, translationWorkerPayload{}
}

type translationOutcome struct {
	result utility.Result
	err    error
}

func startTranslation(ctx context.Context, service *Service, markdown string) chan translationOutcome {
	resultCh := make(chan translationOutcome, 1)
	go func() {
		result, err := service.TranslateMarkdown(ctx, "ses_translation", utility.LanguagePortuguese, markdown)
		resultCh <- translationOutcome{result: result, err: err}
	}()
	return resultCh
}

// The worker is handed a sealed request bundle, not an instruction to compose.
// Everything the provider is asked for — the prompt, the source, the exact
// filename of the answer — is inside the archive the engine built.
func TestTranslateMarkdownDispatchesARequestBundle(t *testing.T) {
	service, store := translationService(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	resultCh := startTranslation(ctx, service, "# Hello")

	task, payload := awaitTranslationTask(t, store)
	if task.Type != "TRANSLATE_MARKDOWN" || task.Priority != -1 {
		t.Fatalf("translation task=%#v", task)
	}
	if payload.Protocol != translation.RequestProtocolV1 || payload.Task != translation.TaskTranslateDocument {
		t.Fatalf("worker payload must carry its protocol identity, got protocol=%q task=%q", payload.Protocol, payload.Task)
	}
	if payload.RequestFilename != "whx_translation_req_"+task.TaskID+".zip" {
		t.Fatalf("request filename=%q", payload.RequestFilename)
	}
	if payload.ResultFilename != "whx_translation_res_"+task.TaskID+".zip" {
		t.Fatalf("result filename=%q", payload.ResultFilename)
	}
	// The bootstrap is the only thing that reaches the composer, so it must name
	// the archive and the expected answer and carry nothing else.
	if !strings.Contains(payload.Bootstrap, payload.ResultFilename) || strings.Contains(payload.Bootstrap, "# Hello") {
		t.Fatalf("composer bootstrap must name the expected artifact and never carry the document: %q", payload.Bootstrap)
	}
	archive, err := base64.StdEncoding.DecodeString(payload.ArchiveBase64)
	if err != nil || len(archive) == 0 {
		t.Fatalf("request archive bytes=%d err=%v", len(archive), err)
	}
	reader, err := zip.NewReader(bytes.NewReader(archive), int64(len(archive)))
	if err != nil {
		t.Fatal(err)
	}
	present := map[string]bool{}
	for _, entry := range reader.File {
		present[entry.Name] = true
	}
	for _, required := range []string{translation.TransportPath, translation.PromptPath, translation.SourcePath} {
		if !present[required] {
			t.Fatalf("request archive is missing %s", required)
		}
	}

	claimed, err := store.ClaimChatAgentTask("worker-1", 30*time.Second)
	if err != nil || claimed == nil || claimed.TaskID != task.TaskID {
		t.Fatalf("claim translation=%#v err=%v", claimed, err)
	}
	completeTranslation(t, store, task.TaskID, payload, translationResponse(t, validResultManifest(t, archive, task.TaskID), "# Olá"))

	select {
	case got := <-resultCh:
		if got.err != nil {
			t.Fatal(got.err)
		}
		if got.result.Markdown != "# Olá" || got.result.TargetLanguage != utility.LanguagePortuguese {
			t.Fatalf("translation result=%#v", got.result)
		}
	case <-ctx.Done():
		t.Fatal("TranslateMarkdown did not observe the completed worker task")
	}
}

// A translation of some other document is the failure the old raw-Markdown
// exchange could not even describe: nothing tied the answer to the request. The
// digest makes it a refusal rather than a silent wrong answer.
func TestTranslateMarkdownRejectsABundleForADifferentSource(t *testing.T) {
	service, store := translationService(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	resultCh := startTranslation(ctx, service, "# Hello")

	task, payload := awaitTranslationTask(t, store)
	if _, err := store.ClaimChatAgentTask("worker-1", 30*time.Second); err != nil {
		t.Fatal(err)
	}
	manifest := translation.ResultManifest{
		Protocol: translation.ResultProtocolV1, Task: translation.TaskTranslateDocument, TaskID: task.TaskID,
		TargetLanguage: "pt", SourceSHA256: strings.Repeat("a", 64), ResultPath: translation.ResultPath,
	}
	completeTranslation(t, store, task.TaskID, payload, translationResponse(t, manifest, "# Outro documento"))

	select {
	case got := <-resultCh:
		if got.err == nil {
			t.Fatalf("a bundle declaring another source must be refused, got %#v", got.result)
		}
		if !strings.Contains(got.err.Error(), "different source document") {
			t.Fatalf("refusal must name the mismatch, got %v", got.err)
		}
	case <-ctx.Done():
		t.Fatal("TranslateMarkdown did not observe the completed worker task")
	}
}

// Prose instead of a file, or a file under some other name, used to leave the
// worker waiting until it timed out. Now it is a named refusal.
func TestTranslateMarkdownRejectsAnUnexpectedFilename(t *testing.T) {
	service, store := translationService(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	resultCh := startTranslation(ctx, service, "# Hello")

	task, payload := awaitTranslationTask(t, store)
	if _, err := store.ClaimChatAgentTask("worker-1", 30*time.Second); err != nil {
		t.Fatal(err)
	}
	archive, err := base64.StdEncoding.DecodeString(payload.ArchiveBase64)
	if err != nil {
		t.Fatal(err)
	}
	bundle := translationResponse(t, validResultManifest(t, archive, task.TaskID), "# Olá")
	result, err := json.Marshal(translationWorkerResult{
		Protocol: translation.ResultProtocolV1, TaskID: task.TaskID,
		Filename: "translation.zip", BundleBase64: base64.StdEncoding.EncodeToString(bundle),
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.CompleteChatAgentTaskWithPayload(task.TaskID, "worker-1", result); err != nil {
		t.Fatal(err)
	}

	select {
	case got := <-resultCh:
		if got.err == nil || !strings.Contains(got.err.Error(), "whx_translation_res_") {
			t.Fatalf("an unexpected filename must be refused by name, got result=%#v err=%v", got.result, got.err)
		}
	case <-ctx.Done():
		t.Fatal("TranslateMarkdown did not observe the completed worker task")
	}
}

func completeTranslation(t *testing.T, store *session.Store, taskID string, payload translationWorkerPayload, bundle []byte) {
	t.Helper()
	result, err := json.Marshal(translationWorkerResult{
		Protocol: translation.ResultProtocolV1, TaskID: taskID,
		Filename: payload.ResultFilename, BundleBase64: base64.StdEncoding.EncodeToString(bundle),
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.CompleteChatAgentTaskWithPayload(taskID, "worker-1", result); err != nil {
		t.Fatal(err)
	}
}

// validResultManifest echoes the request's own transport manifest, which is
// exactly what the prompt asks the provider to do.
func validResultManifest(t *testing.T, archive []byte, taskID string) translation.ResultManifest {
	t.Helper()
	reader, err := zip.NewReader(bytes.NewReader(archive), int64(len(archive)))
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range reader.File {
		if entry.Name != translation.TransportPath {
			continue
		}
		rc, openErr := entry.Open()
		if openErr != nil {
			t.Fatal(openErr)
		}
		defer rc.Close()
		var transport translation.TransportManifest
		if err := json.NewDecoder(rc).Decode(&transport); err != nil {
			t.Fatal(err)
		}
		return translation.ResultManifest{
			Protocol: translation.ResultProtocolV1, Task: translation.TaskTranslateDocument, TaskID: taskID,
			TargetLanguage: transport.TargetLanguage, SourceSHA256: transport.SourceSHA256, ResultPath: transport.ResultPath,
		}
	}
	t.Fatalf("request archive has no %s", translation.TransportPath)
	return translation.ResultManifest{}
}
