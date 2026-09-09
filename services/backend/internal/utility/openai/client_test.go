package openai

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"kernl.local/harness/backend/internal/utility"
)

func TestExecuteTranslatesMarkdownThroughStructuredUtilityProtocol(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/responses" {
			http.NotFound(w, r)
			return
		}
		if r.Header.Get("Authorization") != "Bearer test-key" {
			t.Fatalf("missing authorization header")
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body["store"] != false || body["model"] != "gpt-test" {
			t.Fatalf("unexpected provider body: %#v", body)
		}
		result := utility.Result{Protocol: utility.ProtocolV1, Task: utility.TaskTranslateMarkdown, TargetLanguage: utility.LanguageEnglish, Markdown: "# Hello\n\n`go test`"}
		encoded, _ := json.Marshal(result)
		_ = json.NewEncoder(w).Encode(map[string]any{"output_text": string(encoded)})
	}))
	defer server.Close()

	client := New("test-key", "gpt-test", server.URL)
	result, err := client.Execute(context.Background(), utility.Request{Task: utility.TaskTranslateMarkdown, TargetLanguage: utility.LanguageEnglish, Markdown: "# Olá\n\n`go test`"})
	if err != nil {
		t.Fatal(err)
	}
	if result.Markdown != "# Hello\n\n`go test`" || result.TargetLanguage != utility.LanguageEnglish {
		t.Fatalf("unexpected result: %#v", result)
	}
}
