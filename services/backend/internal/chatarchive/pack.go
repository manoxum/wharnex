package chatarchive

import (
	"archive/tar"
	"encoding/json"
	"fmt"
	"io"
	"strings"

	"github.com/klauspost/compress/zstd"
	"kernl.local/harness/backend/internal/domain"
)

const (
	entryManifest = "manifest.json"
	entryEvents   = "events.jsonl"
	artifactsDir  = "artifacts/"
	contextDir    = "context/"
)

// Build writes one tar stream (manifest.json, events.jsonl, artifacts/<id>,
// context/<request_id>) wrapped in a single zstd pass at the library's best
// compression mode, and returns the number of file entries written. Plain
// tar rather than archive/zip: zip's own per-entry DEFLATE would fight the
// single whole-stream zstd pass wrapped around it.
func Build(w io.Writer, manifest Manifest, events []domain.Event, artifacts map[string][]byte, contextFiles map[string][]byte) (int, error) {
	manifest.FormatVersion = FormatVersion
	contextIDs := make([]string, 0, len(contextFiles))
	for id := range contextFiles {
		contextIDs = append(contextIDs, id)
	}
	manifest.ContextFiles = contextIDs

	encoder, err := zstd.NewWriter(w, zstd.WithEncoderLevel(zstd.SpeedBestCompression))
	if err != nil {
		return 0, fmt.Errorf("open zstd encoder: %w", err)
	}
	tw := tar.NewWriter(encoder)
	entries := 0

	manifestRaw, err := json.Marshal(manifest)
	if err != nil {
		_ = tw.Close()
		_ = encoder.Close()
		return 0, fmt.Errorf("encode archive manifest: %w", err)
	}
	if err := writeTarEntry(tw, entryManifest, manifestRaw); err != nil {
		_ = tw.Close()
		_ = encoder.Close()
		return 0, err
	}
	entries++

	eventsRaw, err := encodeEventsJSONL(events)
	if err != nil {
		_ = tw.Close()
		_ = encoder.Close()
		return 0, err
	}
	if err := writeTarEntry(tw, entryEvents, eventsRaw); err != nil {
		_ = tw.Close()
		_ = encoder.Close()
		return 0, err
	}
	entries++

	for _, record := range manifest.Artifacts {
		id, err := sanitizeSegment(record.ID)
		if err != nil {
			_ = tw.Close()
			_ = encoder.Close()
			return 0, fmt.Errorf("archive artifact entry: %w", err)
		}
		raw, ok := artifacts[record.ID]
		if !ok {
			_ = tw.Close()
			_ = encoder.Close()
			return 0, fmt.Errorf("archive artifact entry: missing bytes for artifact %s", record.ID)
		}
		if err := writeTarEntry(tw, artifactsDir+id, raw); err != nil {
			_ = tw.Close()
			_ = encoder.Close()
			return 0, err
		}
		entries++
	}

	for _, requestID := range contextIDs {
		id, err := sanitizeSegment(requestID)
		if err != nil {
			_ = tw.Close()
			_ = encoder.Close()
			return 0, fmt.Errorf("archive context entry: %w", err)
		}
		if err := writeTarEntry(tw, contextDir+id, contextFiles[requestID]); err != nil {
			_ = tw.Close()
			_ = encoder.Close()
			return 0, err
		}
		entries++
	}

	if err := tw.Close(); err != nil {
		_ = encoder.Close()
		return 0, fmt.Errorf("finalize archive tar stream: %w", err)
	}
	if err := encoder.Close(); err != nil {
		return 0, fmt.Errorf("finalize archive zstd stream: %w", err)
	}
	return entries, nil
}

func writeTarEntry(tw *tar.Writer, name string, raw []byte) error {
	header := &tar.Header{Name: name, Size: int64(len(raw)), Mode: 0o600, Typeflag: tar.TypeReg}
	if err := tw.WriteHeader(header); err != nil {
		return fmt.Errorf("write archive entry header %s: %w", name, err)
	}
	if _, err := tw.Write(raw); err != nil {
		return fmt.Errorf("write archive entry body %s: %w", name, err)
	}
	return nil
}

func encodeEventsJSONL(events []domain.Event) ([]byte, error) {
	var buf strings.Builder
	for _, event := range events {
		line, err := json.Marshal(event)
		if err != nil {
			return nil, fmt.Errorf("encode archived event %s: %w", event.ID, err)
		}
		buf.Write(line)
		buf.WriteByte('\n')
	}
	return []byte(buf.String()), nil
}

// sanitizeSegment rejects anything that isn't a single, unambiguous path
// segment before it becomes part of a tar entry name (on write) or before a
// decoded id is trusted (on read, see Unpack) — these bytes eventually round
// trip through MinIO and must never be treated as implicitly safe.
func sanitizeSegment(raw string) (string, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" || trimmed == "." || trimmed == ".." {
		return "", fmt.Errorf("invalid archive segment %q", raw)
	}
	if strings.ContainsAny(trimmed, "/\\") {
		return "", fmt.Errorf("invalid archive segment %q", raw)
	}
	return trimmed, nil
}
