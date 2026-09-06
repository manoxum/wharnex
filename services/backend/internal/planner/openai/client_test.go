package openai

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"sync/atomic"
	"testing"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/planner"
)

func TestPlanUploadsContextAndParsesStructuredResponse(t *testing.T) {
	var uploads atomic.Int32
	var responses atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-key" {
			t.Errorf("missing auth header")
		}
		switch r.URL.Path {
		case "/files":
			uploads.Add(1)
			if err := r.ParseMultipartForm(1 << 20); err != nil {
				t.Errorf("multipart: %v", err)
			}
			if got := r.FormValue("purpose"); got != "user_data" {
				t.Errorf("purpose=%q", got)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"id":"file_ctx"}`))
		case "/responses":
			responses.Add(1)
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Errorf("decode request: %v", err)
			}
			if body["model"] != "gpt-test" {
				t.Errorf("model=%v", body["model"])
			}
			if responses.Load() == 2 && body["previous_response_id"] != "resp1" {
				t.Errorf("previous_response_id=%v", body["previous_response_id"])
			}
			input, ok := body["input"].([]any)
			if !ok || len(input) != 1 {
				t.Fatalf("structured input missing: %#v", body["input"])
			}
			message := input[0].(map[string]any)
			content := message["content"].([]any)
			foundFile := false
			for _, raw := range content {
				item := raw.(map[string]any)
				if item["type"] == "input_file" && item["file_id"] == "file_ctx" {
					foundFile = true
				}
			}
			if !foundFile {
				t.Error("context input_file missing")
			}
			requestID := "req1"
			if responses.Load() == 2 {
				requestID = "req2"
			}
			turn := domain.AgentTurn{Protocol: domain.TurnProtocolV1, RequestID: requestID, Kind: domain.TurnKindAnswer, Message: "Resposta baseada no projeto.", Outcome: &domain.TurnOutcome{Status: domain.TurnOutcomeCompleted}}
			encoded, _ := json.Marshal(struct {
				domain.AgentTurn
				Plan *domain.ExecutionPlan `json:"plan"`
			}{AgentTurn: turn, Plan: nil})
			responseID := "resp1"
			if responses.Load() == 2 {
				responseID = "resp2"
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"id": responseID, "output_text": string(encoded)})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	contextFile := t.TempDir() + "/context.txt"
	if err := os.WriteFile(contextFile, []byte("safe context"), 0o600); err != nil {
		t.Fatal(err)
	}
	client := New("test-key", "gpt-test", server.URL)
	first, err := client.Plan(context.Background(), planner.Request{RequestID: "req1", Message: "fix", ContextTextPath: contextFile, ContextManifest: domain.ContextManifest{SHA256: "snapshot-1"}})
	if err != nil {
		t.Fatal(err)
	}
	if first.Plan != nil || first.Turn == nil || first.Turn.Kind != domain.TurnKindAnswer || first.ProviderResponseID != "resp1" {
		t.Fatalf("unexpected first result: %#v", first)
	}
	second, err := client.Plan(context.Background(), planner.Request{RequestID: "req2", Message: "continue", ContextTextPath: contextFile, ContextManifest: domain.ContextManifest{SHA256: "snapshot-1"}, PreviousResponseID: "resp1"})
	if err != nil {
		t.Fatal(err)
	}
	if second.Plan != nil || second.Turn == nil || second.Turn.Message == "" || second.ProviderResponseID != "resp2" {
		t.Fatalf("unexpected second result: %#v", second)
	}
	if uploads.Load() != 1 || responses.Load() != 2 {
		t.Fatalf("uploads=%d responses=%d", uploads.Load(), responses.Load())
	}
}

func TestExecutionFormatRequiresExplicitPlannerOutcome(t *testing.T) {
	format := executionFormat("req1", "snapshot-1")
	schema := format["schema"].(map[string]any)
	required := schema["required"].([]string)
	found := false
	for _, field := range required {
		if field == "outcome" {
			found = true
		}
	}
	if !found {
		t.Fatalf("outcome missing from structured output requirements: %#v", required)
	}
	properties := schema["properties"].(map[string]any)
	outcome := properties["outcome"].(map[string]any)
	if outcome["additionalProperties"] != false {
		t.Fatalf("outcome schema is not strict: %#v", outcome)
	}
}
