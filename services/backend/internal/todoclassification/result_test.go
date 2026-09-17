package todoclassification

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

func TestParseResultAcceptsBoundClassificationWithEnrichment(t *testing.T) {
	manifest, _, err := BuildRequest("cat_1234567890abcdef1234", "todo_1", "erro no login", RequestMetadata{})
	if err != nil {
		t.Fatal(err)
	}
	payload, _ := json.Marshal(Result{
		Protocol: ResultProtocolV1, Task: TaskClassifyTodo, TaskID: manifest.TaskID, TodoID: manifest.TodoID,
		SourceSHA256: manifest.SourceSHA256, Kind: "error", Urgency: "urgent",
		Description: "  Corrigir o fluxo de autenticação e validar o comportamento esperado.  ",
		PrePlan:     []string{" Reproduzir a falha. ", "Aplicar a correção.", "Validar o login."},
	})
	bundle := testResultBundle(t, payload)
	got, err := ParseResult(manifest.ResultFilename, bundle, manifest)
	if err != nil {
		t.Fatal(err)
	}
	if got.Kind != "error" || got.Urgency != "urgent" || got.Description != "Corrigir o fluxo de autenticação e validar o comportamento esperado." {
		t.Fatalf("unexpected classification: %+v", got)
	}
	if len(got.PrePlan) != 3 || got.PrePlan[0] != "Reproduzir a falha." {
		t.Fatalf("unexpected pre-plan: %#v", got.PrePlan)
	}
}

func TestRequestPromptRequiresDescriptionAndPrePlan(t *testing.T) {
	manifest, _, err := BuildRequest("cat_1234567890abcdef1234", "todo_1", "feature idea", RequestMetadata{})
	if err != nil {
		t.Fatal(err)
	}
	prompt := RequestPrompt(manifest)
	for _, want := range []string{"`description`", "`pre_plan`", "2 to 6 concise implementation steps", "without inventing unavailable project facts"} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("classification prompt missing %q", want)
		}
	}
}

func TestParseResultRejectsWrongSourceExtraFilesAndOversizedEnrichment(t *testing.T) {
	manifest, _, err := BuildRequest("cat_1234567890abcdef1234", "todo_1", "feature idea", RequestMetadata{})
	if err != nil {
		t.Fatal(err)
	}
	payload, _ := json.Marshal(Result{Protocol: ResultProtocolV1, Task: TaskClassifyTodo, TaskID: manifest.TaskID, TodoID: manifest.TodoID, SourceSHA256: "deadbeef", Kind: "feature", Urgency: "normal"})
	if _, err := ParseResult(manifest.ResultFilename, testResultBundle(t, payload), manifest); err == nil {
		t.Fatal("wrong source hash must be rejected")
	}

	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	first, _ := writer.Create(ResultPath)
	_, _ = first.Write(payload)
	second, _ := writer.Create("extra.txt")
	_, _ = second.Write([]byte("unexpected"))
	_ = writer.Close()
	if _, err := ParseResult(manifest.ResultFilename, buffer.Bytes(), manifest); err == nil {
		t.Fatal("extra archive entries must be rejected")
	}

	oversized, _ := json.Marshal(Result{
		Protocol: ResultProtocolV1, Task: TaskClassifyTodo, TaskID: manifest.TaskID, TodoID: manifest.TodoID,
		SourceSHA256: manifest.SourceSHA256, Kind: "feature", Urgency: "normal",
		Description: strings.Repeat("x", MaxDescriptionChars+1), PrePlan: []string{"Inspect.", "Verify."},
	})
	if _, err := ParseResult(manifest.ResultFilename, testResultBundle(t, oversized), manifest); err == nil {
		t.Fatal("oversized description must be rejected")
	}
}

func testResultBundle(t *testing.T, payload []byte) []byte {
	t.Helper()
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	entry, err := writer.Create(ResultPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := entry.Write(payload); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}
