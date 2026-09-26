package releasenotes

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

const testTaskID = "cat_0123456789abcdef0123"

func TestBuildRequestCarriesStrictBundleContract(t *testing.T) {
	manifest, raw, err := BuildRequest(testTaskID, "origin/main", "- abc123 fix release publishing\n", RequestMetadata{ChatID: "chat-1"})
	if err != nil {
		t.Fatal(err)
	}
	if manifest.ResultFilename != "whx_release_notes_res_"+testTaskID+".zip" {
		t.Fatalf("unexpected result filename %q", manifest.ResultFilename)
	}
	if !strings.Contains(RequestBootstrap(manifest), "Return only "+manifest.ResultFilename) {
		t.Fatalf("bootstrap does not constrain the response filename")
	}
	reader, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, file := range reader.File {
		seen[file.Name] = true
	}
	for _, required := range []string{TransportPath, PromptPath, SourcePath} {
		if !seen[required] {
			t.Fatalf("request bundle missing %s", required)
		}
	}
}

func TestParseResultRejectsForeignIdentityAndFreeFormShape(t *testing.T) {
	request, _, err := BuildRequest(testTaskID, "origin/main", "- abc123 fix release publishing\n", RequestMetadata{})
	if err != nil {
		t.Fatal(err)
	}
	valid := ResultManifest{
		Protocol: ResultProtocolV1, Task: TaskGenerate, TaskID: request.TaskID,
		Branch: request.Branch, SourceSHA256: request.SourceSHA256, ResultPath: ResultPath,
	}
	bundle := resultBundle(t, valid, "## Fixes\n- Release publishing works.\n")
	parsed, err := ParseResult(request.ResultFilename, bundle, request)
	if err != nil || !strings.Contains(parsed.Body, "Release publishing") {
		t.Fatalf("valid bundle rejected: result=%+v err=%v", parsed, err)
	}
	valid.SourceSHA256 = strings.Repeat("0", 64)
	if _, err := ParseResult(request.ResultFilename, resultBundle(t, valid, "notes"), request); err == nil {
		t.Fatal("expected a foreign-source bundle to be rejected")
	}
	if _, err := ParseResult(request.ResultFilename, []byte("plain prose"), request); err == nil {
		t.Fatal("expected a free-form response to be rejected")
	}
}

func resultBundle(t *testing.T, manifest ResultManifest, body string) []byte {
	t.Helper()
	manifestBytes, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	buffer := &bytes.Buffer{}
	writer := zip.NewWriter(buffer)
	for _, entry := range []struct {
		name string
		data []byte
	}{{ResultManifestPath, manifestBytes}, {ResultPath, []byte(body)}} {
		part, err := writer.Create(entry.name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := part.Write(entry.data); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}
