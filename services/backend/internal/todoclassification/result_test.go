package todoclassification

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"testing"
)

func TestParseResultAcceptsBoundClassification(t *testing.T) {
	manifest, _, err := BuildRequest("cat_1234567890abcdef1234", "todo_1", "erro no login", RequestMetadata{})
	if err != nil {
		t.Fatal(err)
	}
	payload, _ := json.Marshal(Result{Protocol: ResultProtocolV1, Task: TaskClassifyTodo, TaskID: manifest.TaskID, TodoID: manifest.TodoID, SourceSHA256: manifest.SourceSHA256, Kind: "error", Urgency: "urgent"})
	bundle := testResultBundle(t, payload)
	got, err := ParseResult(manifest.ResultFilename, bundle, manifest)
	if err != nil {
		t.Fatal(err)
	}
	if got.Kind != "error" || got.Urgency != "urgent" {
		t.Fatalf("unexpected classification: %+v", got)
	}
}

func TestParseResultRejectsWrongSourceAndExtraFiles(t *testing.T) {
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
