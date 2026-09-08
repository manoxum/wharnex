package chatarchive

import (
	"archive/tar"
	"bytes"
	"strings"
	"testing"
	"time"

	"github.com/klauspost/compress/zstd"
	"kernl.local/harness/backend/internal/domain"
)

func TestPackUnpackRoundTrip(t *testing.T) {
	manifest := Manifest{
		SessionID: "ses_1",
		CreatedAt: time.Now().UTC(),
		Artifacts: []domain.ArtifactRecord{
			{ID: "artifact_a", Direction: "input", Kind: "bundle", Name: "input.zip", Size: 3, SHA256: "abc", ObjectKey: "sessions/ses_1/artifact_a"},
			{ID: "artifact_b", Direction: "output", Kind: "bundle", Name: "output.zip", Size: 3, SHA256: "def", ObjectKey: "sessions/ses_1/artifact_b"},
		},
	}
	events := []domain.Event{
		{ID: "evt_1", SessionID: "ses_1", Type: "artifact.persisted", Timestamp: time.Now().UTC(), Data: map[string]any{"bytes": float64(3)}},
		{ID: "evt_2", SessionID: "ses_1", Type: "session.archived", Timestamp: time.Now().UTC(), Data: map[string]any{}},
	}
	artifacts := map[string][]byte{"artifact_a": []byte("AAA"), "artifact_b": []byte("BBB")}
	contextFiles := map[string][]byte{"req_1": []byte("context-zip-bytes")}

	var buf bytes.Buffer
	entries, err := Build(&buf, manifest, events, artifacts, contextFiles)
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	// manifest + events + 2 artifacts + 1 context file
	if entries != 5 {
		t.Fatalf("expected 5 entries, got %d", entries)
	}

	pkg, err := Unpack(&buf)
	if err != nil {
		t.Fatalf("Unpack: %v", err)
	}
	if pkg.Manifest.SessionID != "ses_1" || len(pkg.Manifest.Artifacts) != 2 {
		t.Fatalf("unexpected manifest: %#v", pkg.Manifest)
	}
	if len(pkg.Events) != 2 || pkg.Events[0].ID != "evt_1" || pkg.Events[1].ID != "evt_2" {
		t.Fatalf("unexpected events: %#v", pkg.Events)
	}
	if string(pkg.Artifacts["artifact_a"]) != "AAA" || string(pkg.Artifacts["artifact_b"]) != "BBB" {
		t.Fatalf("unexpected artifact bytes: %#v", pkg.Artifacts)
	}
	if string(pkg.ContextFiles["req_1"]) != "context-zip-bytes" {
		t.Fatalf("unexpected context bytes: %#v", pkg.ContextFiles)
	}
	// ObjectKey must never survive the round trip: it's json:"-" and the
	// original MinIO objects are deleted once compaction succeeds, so a
	// restore must never resurrect a stale key.
	for _, record := range pkg.Manifest.Artifacts {
		if record.ObjectKey != "" {
			t.Fatalf("archive manifest leaked an object key: %#v", record)
		}
	}
}

func TestUnpackRejectsUnsupportedFormatVersion(t *testing.T) {
	var buf bytes.Buffer
	encoder, err := zstd.NewWriter(&buf)
	if err != nil {
		t.Fatal(err)
	}
	tw := tar.NewWriter(encoder)
	if err := writeTarEntry(tw, entryManifest, []byte(`{"format_version":999,"session_id":"ses_1"}`)); err != nil {
		t.Fatal(err)
	}
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := encoder.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := Unpack(&buf); err == nil {
		t.Fatal("expected Unpack to reject an unsupported manifest format version")
	}
}

func TestUnpackRejectsPathTraversalEntries(t *testing.T) {
	cases := []string{"artifacts/../../etc/passwd", "artifacts/../secret", "context/../../etc/passwd", "unexpected/entry"}
	for _, name := range cases {
		t.Run(name, func(t *testing.T) {
			raw := maliciousArchive(t, name, []byte("payload"))
			if _, err := Unpack(bytes.NewReader(raw)); err == nil {
				t.Fatalf("expected Unpack to reject entry %q", name)
			}
		})
	}
}

// maliciousArchive builds a minimal valid manifest entry plus one attacker
// controlled entry name, bypassing Build's own sanitization to exercise
// Unpack's independent defense.
func maliciousArchive(t *testing.T, entryName string, payload []byte) []byte {
	t.Helper()
	var buf bytes.Buffer
	encoder, err := zstd.NewWriter(&buf)
	if err != nil {
		t.Fatal(err)
	}
	tw := tar.NewWriter(encoder)
	manifestRaw := []byte(`{"format_version":1,"session_id":"ses_1"}`)
	if err := writeTarEntry(tw, entryManifest, manifestRaw); err != nil {
		t.Fatal(err)
	}
	if err := writeTarEntry(tw, entryName, payload); err != nil {
		t.Fatal(err)
	}
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := encoder.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestPackUsesMaterialCompression(t *testing.T) {
	compressible := []byte(strings.Repeat("wharness chat archive compaction ", 4096))
	manifest := Manifest{SessionID: "ses_1", Artifacts: []domain.ArtifactRecord{{ID: "artifact_a", Name: "input.zip"}}}
	var buf bytes.Buffer
	if _, err := Build(&buf, manifest, nil, map[string][]byte{"artifact_a": compressible}, nil); err != nil {
		t.Fatalf("Build: %v", err)
	}
	if buf.Len() >= len(compressible)/4 {
		t.Fatalf("expected best-compression output well under a quarter of the input size, got %d bytes for %d bytes input", buf.Len(), len(compressible))
	}
}
