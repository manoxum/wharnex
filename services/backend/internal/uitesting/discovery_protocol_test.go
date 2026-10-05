package uitesting

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"io"
	"io/fs"
	"strings"
	"testing"
)

func TestDiscoveryBundleRoundTripBindsResultToRequest(t *testing.T) {
	manifest, requestBundle, err := BuildDiscoveryRequest(
		"cat_1234567890abcdef1234", strings.Repeat("a", 64), []byte("project-context"),
		DiscoveryRequestMetadata{ChatTitle: "UI Lab discovery", ChatID: "chat-1", ChatHash: strings.Repeat("b", 64), RequestedAt: "2026-10-02T11:00:00Z"},
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(requestBundle) == 0 || !strings.Contains(DiscoveryRequestBootstrap(manifest), manifest.ResultFilename) {
		t.Fatal("discovery request bundle/bootstrap was not built")
	}
	payload, _ := json.Marshal(DiscoveryResult{
		Protocol: DiscoveryResultProtocolV1, Task: DiscoveryTask, TaskID: manifest.TaskID,
		ContextSHA256: manifest.ContextSHA256, SourceSHA256: manifest.SourceSHA256,
		Environments: []Environment{{ID: "backoffice", Name: "Backoffice", Profiles: []Profile{{ID: "admin", Label: "Admin", Role: "administrator"}}}},
		Tests:        []TestCase{{ID: "login-admin", Title: "Login", Goal: "Validate login", EnvironmentID: "backoffice", ProfileID: "admin", Priority: "high"}},
	})
	bundle := discoveryResultBundle(t, payload)
	result, err := ParseDiscoveryResult(manifest.ResultFilename, bundle, manifest)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Environments) != 1 || len(result.Tests) != 1 || result.ContextSHA256 != manifest.ContextSHA256 {
		t.Fatalf("unexpected discovery result: %#v", result)
	}
}

func TestDiscoveryBundleRejectsForeignIdentityAndInvalidReferences(t *testing.T) {
	manifest, _, err := BuildDiscoveryRequest("cat_1234567890abcdef1234", strings.Repeat("a", 64), []byte("ctx"), DiscoveryRequestMetadata{})
	if err != nil {
		t.Fatal(err)
	}
	foreign, _ := json.Marshal(DiscoveryResult{Protocol: DiscoveryResultProtocolV1, Task: DiscoveryTask, TaskID: manifest.TaskID, ContextSHA256: manifest.ContextSHA256, SourceSHA256: "deadbeef"})
	if _, err := ParseDiscoveryResult(manifest.ResultFilename, discoveryResultBundle(t, foreign), manifest); err == nil {
		t.Fatal("foreign source hash must be rejected")
	}
	invalid, _ := json.Marshal(DiscoveryResult{
		Protocol: DiscoveryResultProtocolV1, Task: DiscoveryTask, TaskID: manifest.TaskID, ContextSHA256: manifest.ContextSHA256, SourceSHA256: manifest.SourceSHA256,
		Tests: []TestCase{{ID: "login", Title: "Login", Goal: "Validate login", EnvironmentID: "missing"}},
	})
	if _, err := ParseDiscoveryResult(manifest.ResultFilename, discoveryResultBundle(t, invalid), manifest); err == nil {
		t.Fatal("unknown environment reference must be rejected")
	}
}

func discoveryResultBundle(t *testing.T, payload []byte) []byte {
	t.Helper()
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	entry, err := writer.Create(DiscoveryResultPath)
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

func TestDiscoveryBundleRejectsTrailingResponseData(t *testing.T) {
	manifest, _, err := BuildDiscoveryRequest("cat_1234567890abcdef1234", strings.Repeat("a", 64), []byte("ctx"), DiscoveryRequestMetadata{})
	if err != nil {
		t.Fatal(err)
	}
	payload, _ := json.Marshal(DiscoveryResult{Protocol: DiscoveryResultProtocolV1, Task: DiscoveryTask, TaskID: manifest.TaskID, ContextSHA256: manifest.ContextSHA256, SourceSHA256: manifest.SourceSHA256})
	for _, trailing := range []string{`{}`, `false`, `untrusted trailing prose`} {
		t.Run(trailing, func(t *testing.T) {
			if _, err := ParseDiscoveryResult(manifest.ResultFilename, discoveryResultBundle(t, append(payload, []byte(trailing)...)), manifest); err == nil {
				t.Fatal("trailing response data must be rejected")
			}
		})
	}
}

func TestDiscoveryRequestContainsInstructionsAndExactContext(t *testing.T) {
	context := []byte("untrusted project input")
	manifest, bundle, err := BuildDiscoveryRequest("cat_1234567890abcdef1234", strings.Repeat("a", 64), context, DiscoveryRequestMetadata{})
	if err != nil {
		t.Fatal(err)
	}
	reader, err := zip.NewReader(bytes.NewReader(bundle), int64(len(bundle)))
	if err != nil {
		t.Fatal(err)
	}
	if len(reader.File) != 3 {
		t.Fatalf("got %d entries", len(reader.File))
	}
	entries := map[string][]byte{}
	for _, entry := range reader.File {
		opened, err := entry.Open()
		if err != nil {
			t.Fatal(err)
		}
		raw, err := io.ReadAll(opened)
		opened.Close()
		if err != nil {
			t.Fatal(err)
		}
		entries[entry.Name] = raw
	}
	var stored DiscoveryTransportManifest
	if err := json.Unmarshal(entries[DiscoveryTransportPath], &stored); err != nil {
		t.Fatal(err)
	}
	if stored != manifest {
		t.Fatal("transport differs from engine contract")
	}
	if !bytes.Equal(entries[DiscoveryContextPath], context) {
		t.Fatal("context changed")
	}
	if !bytes.Contains(entries[DiscoveryPromptPath], []byte(manifest.ResultFilename)) {
		t.Fatal("instructions omit expected response")
	}
	if strings.Contains(DiscoveryRequestBootstrap(manifest), string(context)) {
		t.Fatal("project input leaked into composer")
	}
}

func TestDiscoveryBundleRejectsUnsafeResultEntries(t *testing.T) {
	manifest, _, err := BuildDiscoveryRequest("cat_1234567890abcdef1234", strings.Repeat("a", 64), []byte("ctx"), DiscoveryRequestMetadata{})
	if err != nil {
		t.Fatal(err)
	}
	payload, _ := json.Marshal(DiscoveryResult{Protocol: DiscoveryResultProtocolV1, Task: DiscoveryTask, TaskID: manifest.TaskID, ContextSHA256: manifest.ContextSHA256, SourceSHA256: manifest.SourceSHA256})
	for _, mode := range []fs.FileMode{fs.ModeSymlink, fs.ModeNamedPipe, fs.ModeSocket, fs.ModeDevice, fs.ModeDir} {
		t.Run(mode.String(), func(t *testing.T) {
			var buffer bytes.Buffer
			writer := zip.NewWriter(&buffer)
			header := &zip.FileHeader{Name: DiscoveryResultPath}
			header.SetMode(mode | 0600)
			entry, err := writer.CreateHeader(header)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := entry.Write(payload); err != nil {
				t.Fatal(err)
			}
			if err := writer.Close(); err != nil {
				t.Fatal(err)
			}
			if _, err := ParseDiscoveryResult(manifest.ResultFilename, buffer.Bytes(), manifest); err == nil {
				t.Fatal("non-regular result entry accepted")
			}
		})
	}
}
