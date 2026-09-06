package app

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"io"
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
)

func TestChatExportContainsAuditHistoryAndOriginalBundles(t *testing.T) {
	rootRequest := "req_20260906T210349_aaaaaaaaaaaaaaaa"
	repairRequest := "req_20260906T211500_bbbbbbbbbbbbbbbb"
	lastExecution := &domain.ExecutionResult{PlanID: "plan_root", Success: false, StartedAt: time.Now().UTC(), CompletedAt: time.Now().UTC(), Commands: []domain.CommandResult{{Argv: []string{"go", "test", "./..."}, ExitCode: 1, Stderr: "failed", Success: false}}, Error: "verification failed"}
	store := session.NewStore()
	if err := store.Put(domain.Session{
		ID: "ses_export", ChatID: "chat-export", ProjectPath: t.TempDir(), CreatedAt: time.Now().UTC(),
		LastExecution: lastExecution, Policy: &domain.PolicyDecision{Allowed: true, RequiresApproval: true, Risk: "medium", Reasons: []string{"network"}},
		RequestLineages: map[string]domain.RequestLineage{
			rootRequest:   {RequestID: rootRequest, RootRequestID: rootRequest, Kind: "standard"},
			repairRequest: {RequestID: repairRequest, RootRequestID: rootRequest, ParentRequestID: rootRequest, Kind: "repair"},
		},
	}); err != nil {
		t.Fatal(err)
	}
	bus := audit.NewBus()
	service := NewService(store, bus, contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), sandbox.NewLocalRunner())
	objects := &memoryArtifactStore{objects: map[string][]byte{}}
	service.SetArtifactStore(objects, 30)

	mainRequest := testArtifactZIP(t, map[string]string{"prompt/main.md": "main request"})
	mainResponse := testArtifactZIP(t, map[string]string{"turn.json": `{"message":"main response"}`})
	repairRequestZIP := testArtifactZIP(t, map[string]string{"prompt/repair.md": "repair request"})
	repairResponseZIP := testArtifactZIP(t, map[string]string{"turn.json": `{"message":"repair response"}`})
	for _, artifact := range []struct {
		requestID, direction, name string
		raw                        []byte
	}{
		{rootRequest, "input", "main-request.zip", mainRequest},
		{rootRequest, "output", "main-response.zip", mainResponse},
		{repairRequest, "input", "repair-request.zip", repairRequestZIP},
		{repairRequest, "output", "repair-response.zip", repairResponseZIP},
	} {
		if _, err := service.PersistArtifact(context.Background(), "ses_export", artifact.requestID, artifact.direction, "bundle", artifact.name, "application/zip", artifact.raw); err != nil {
			t.Fatal(err)
		}
	}
	bus.Publish("ses_export", "sandbox.dependency_network_approval_required", map[string]any{"plan_id": "plan_root", "scope": "go_dependency_commands"})
	bus.Publish("ses_export", "command.completed", map[string]any{"argv": []string{"go", "test", "./..."}, "exit_code": 1, "success": false, "stderr": "failed"})

	input := ChatExportInput{
		ChatID: "chat-export", Title: "Ping pong debug", ChatGPTURL: "https://chatgpt.com/c/example",
		ChatItems: []map[string]any{
			{"id": "u1", "source": "user", "text": "corrigir", "createdAt": "2026-09-06T21:03:49Z", "iteration": map[string]any{"requestId": rootRequest}},
			{"id": "g1", "source": "chatgpt", "text": "primeira resposta", "createdAt": "2026-09-06T21:04:00Z", "turnKind": "change"},
			{"id": "w1", "source": "wharness", "text": "correção 1/3", "iteration": map[string]any{"requestId": repairRequest}},
			{"id": "g2", "source": "chatgpt", "text": "resposta da correção", "iteration": map[string]any{"requestId": repairRequest}},
		},
		FrontendEvents: []domain.Event{{ID: "frontend-1", SessionID: "ses_export", Type: "command.output", Timestamp: time.Now().UTC(), Data: map[string]any{"text": "cached output"}}},
	}
	var buffer bytes.Buffer
	summary, err := service.WriteChatExport(context.Background(), "ses_export", input, &buffer)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(summary.Filename, "wharness-chat-chat-export-") || summary.EntryCount < 14 {
		t.Fatalf("unexpected export summary: %#v", summary)
	}

	archive, err := zip.NewReader(bytes.NewReader(buffer.Bytes()), int64(buffer.Len()))
	if err != nil {
		t.Fatal(err)
	}
	files := map[string][]byte{}
	for _, file := range archive.File {
		handle, err := file.Open()
		if err != nil {
			t.Fatal(err)
		}
		raw, err := io.ReadAll(handle)
		handle.Close()
		if err != nil {
			t.Fatal(err)
		}
		files[file.Name] = raw
	}
	assertZIPPayload(t, files, "bundles/main/request/", "main-request.zip", mainRequest)
	assertZIPPayload(t, files, "bundles/main/response/", "main-response.zip", mainResponse)
	assertZIPPayload(t, files, "bundles/correction/request/", "repair-request.zip", repairRequestZIP)
	assertZIPPayload(t, files, "bundles/correction/response/", "repair-response.zip", repairResponseZIP)
	if !bytes.Contains(files["execution/operational-events.json"], []byte(`"command.completed"`)) || !bytes.Contains(files["security/policy-and-permissions.json"], []byte(`"sandbox.dependency_network_approval_required"`)) {
		t.Fatal("export omitted execution/security audit history")
	}
	var responses []gptExportResponse
	if err := json.Unmarshal(files["chat/gpt-responses-by-request.json"], &responses); err != nil {
		t.Fatal(err)
	}
	if len(responses) != 2 || responses[0].RequestID != rootRequest || responses[1].RequestID != repairRequest {
		t.Fatalf("GPT responses were not correlated to request ids: %#v", responses)
	}
}

func TestChatExportRejectsDifferentChatID(t *testing.T) {
	store := session.NewStore()
	if err := store.Put(domain.Session{ID: "ses_export", ChatID: "expected-chat", ProjectPath: t.TempDir(), CreatedAt: time.Now().UTC()}); err != nil {
		t.Fatal(err)
	}
	service := NewService(store, audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), sandbox.NewLocalRunner())
	var buffer bytes.Buffer
	_, err := service.WriteChatExport(context.Background(), "ses_export", ChatExportInput{ChatID: "other-chat"}, &buffer)
	if err == nil || !strings.Contains(err.Error(), "does not match") {
		t.Fatalf("expected chat affinity rejection, got %v", err)
	}
}

func assertZIPPayload(t *testing.T, files map[string][]byte, prefix, suffix string, want []byte) {
	t.Helper()
	for name, raw := range files {
		if strings.HasPrefix(name, prefix) && strings.HasSuffix(name, suffix) {
			if !bytes.Equal(raw, want) {
				t.Fatalf("artifact %s changed during export", name)
			}
			return
		}
	}
	t.Fatalf("missing exported artifact %s*%s", prefix, suffix)
}
