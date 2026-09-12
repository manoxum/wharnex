package utility

import (
	"encoding/json"
	"strings"
	"testing"
)

func validRequest() Request {
	return Request{Protocol: ProtocolV1, Task: TaskTranslateMarkdown, TargetLanguage: LanguagePortuguese, Markdown: "# Hello"}
}

func TestRequestValidationRequiresTheProtocolIdentity(t *testing.T) {
	if err := ValidateRequest(validRequest()); err != nil {
		t.Fatalf("a complete request must validate: %v", err)
	}
	missing := validRequest()
	missing.Protocol = ""
	err := ValidateRequest(missing)
	if err == nil {
		t.Fatal("a request without its protocol identity must be rejected here rather than by the remote worker")
	}
	if !strings.Contains(err.Error(), "protocol") {
		t.Fatalf("error should name the protocol, got %v", err)
	}
}

// The worker rejects any payload whose wire identity it cannot confirm, so the
// encoded request has to carry the same keys the result does.
func TestEncodedRequestCarriesTheWireKeysTheWorkerValidates(t *testing.T) {
	encoded, err := json.Marshal(validRequest())
	if err != nil {
		t.Fatal(err)
	}
	var wire map[string]any
	if err := json.Unmarshal(encoded, &wire); err != nil {
		t.Fatal(err)
	}
	for key, want := range map[string]any{
		"protocol": ProtocolV1, "task": TaskTranslateMarkdown, "target_language": string(LanguagePortuguese),
	} {
		if got, ok := wire[key]; !ok || got != want {
			t.Fatalf("wire key %q=%v want %v", key, got, want)
		}
	}
}

func TestUnsupportedTaskAndLanguageStayRejected(t *testing.T) {
	other := validRequest()
	other.Task = "summarize"
	if err := ValidateRequest(other); err == nil {
		t.Fatal("an unsupported task must be rejected")
	}
	language := validRequest()
	language.TargetLanguage = "de"
	if err := ValidateRequest(language); err == nil {
		t.Fatal("an unsupported language must be rejected")
	}
	oversized := validRequest()
	oversized.Markdown = strings.Repeat("a", MaxMarkdownBytes+1)
	if err := ValidateRequest(oversized); err == nil {
		t.Fatal("markdown over the utility limit must be rejected")
	}
}
