package httpapi

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"kernl.local/harness/backend/internal/domain"
)

func TestBuildRemotePromptTaskUsesSessionPromptAndDesktopSupervisorShape(t *testing.T) {
	now := time.Date(2026, 9, 23, 21, 50, 0, 0, time.UTC)
	item := domain.Session{
		ID: "ses_remote", ChatID: "chat_remote", ProjectPath: "/work/project",
		AutomationMode: domain.AutomationModeAuto, ReasoningEffort: domain.ReasoningEffortHigh,
		LastRequestID: "req_remote123", LastManualPrompt: "authoritative planner prompt",
	}
	task, err := buildRemotePromptTask(item, remoteDispatchRequest{
		RequestID: "req_remote123", WorkspaceChatID: "chat_remote", BootstrapText: "ship it",
		Attachments:  []remotePromptAttachment{{Name: "notes.txt", MIME: "text/plain", ContentBase64: "bm90ZXM="}},
		ProjectFiles: []string{"README.md", "README.md"}, IncludeContext: true,
	}, now)
	if err != nil {
		t.Fatal(err)
	}
	if task.Type != "BOT_WRITE" || task.ChatID != item.ChatID || task.SessionID != item.ID || task.DedupeKey != "remote-prepare:req_remote123" {
		t.Fatalf("unexpected task: %#v", task)
	}
	var payload struct {
		Operation string `json:"operation"`
		Request   struct {
			Text            string   `json:"text"`
			BootstrapText   string   `json:"bootstrapText"`
			ProjectFiles    []string `json:"projectFiles"`
			IncludeContext  bool     `json:"includeContext"`
			ReasoningEffort string   `json:"reasoningEffort"`
			WorkspaceChatID string   `json:"workspaceChatId"`
		} `json:"request"`
	}
	if err := json.Unmarshal(task.Payload, &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Operation != "PREPARE_PROMPT" || payload.Request.Text != item.LastManualPrompt || payload.Request.BootstrapText != "ship it" || !payload.Request.IncludeContext {
		t.Fatalf("unexpected payload: %#v", payload)
	}
	if payload.Request.ReasoningEffort != "high" || payload.Request.WorkspaceChatID != item.ChatID || len(payload.Request.ProjectFiles) != 1 {
		t.Fatalf("remote composer metadata was not normalized: %#v", payload.Request)
	}
}

func TestBuildRemotePromptTaskRejectsStaleOrManualRequests(t *testing.T) {
	item := domain.Session{ID: "ses", ChatID: "chat", ProjectPath: "/p", AutomationMode: domain.AutomationModeAuto, LastRequestID: "req_live123", LastManualPrompt: "prompt"}
	if _, err := buildRemotePromptTask(item, remoteDispatchRequest{RequestID: "req_stale123", WorkspaceChatID: "chat"}, time.Now()); err == nil || !strings.Contains(err.Error(), "active request") {
		t.Fatalf("stale request was accepted: %v", err)
	}
	item.AutomationMode = domain.AutomationModeManual
	if _, err := buildRemotePromptTask(item, remoteDispatchRequest{RequestID: item.LastRequestID, WorkspaceChatID: "chat"}, time.Now()); err == nil || !strings.Contains(err.Error(), "automatic session") {
		t.Fatalf("manual session was accepted: %v", err)
	}
}
