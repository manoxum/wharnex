package chatarchive

import (
	"archive/tar"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"

	"github.com/klauspost/compress/zstd"
	"kernl.local/harness/backend/internal/domain"
)

// Unpack reverses Build. Every entry name is defensively re-validated (not
// merely trusted because Build only ever wrote well-formed names) since
// these bytes are read back from MinIO, not held in memory continuously.
func Unpack(r io.Reader) (Package, error) {
	decoder, err := zstd.NewReader(r)
	if err != nil {
		return Package{}, fmt.Errorf("open zstd decoder: %w", err)
	}
	defer decoder.Close()

	tr := tar.NewReader(decoder)
	result := Package{Artifacts: map[string][]byte{}, ContextFiles: map[string][]byte{}}
	var manifestSeen bool

	for {
		header, err := tr.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return Package{}, fmt.Errorf("read archive tar stream: %w", err)
		}
		if header.Typeflag != tar.TypeReg {
			continue
		}
		raw, err := io.ReadAll(tr)
		if err != nil {
			return Package{}, fmt.Errorf("read archive entry %s: %w", header.Name, err)
		}
		switch {
		case header.Name == entryManifest:
			var manifest Manifest
			if err := json.Unmarshal(raw, &manifest); err != nil {
				return Package{}, fmt.Errorf("decode archive manifest: %w", err)
			}
			if manifest.FormatVersion != FormatVersion {
				return Package{}, fmt.Errorf("unsupported chat archive format version %d", manifest.FormatVersion)
			}
			result.Manifest = manifest
			manifestSeen = true
		case header.Name == entryEvents:
			events, err := decodeEventsJSONL(raw)
			if err != nil {
				return Package{}, err
			}
			result.Events = events
		case strings.HasPrefix(header.Name, artifactsDir):
			id, err := sanitizeSegment(strings.TrimPrefix(header.Name, artifactsDir))
			if err != nil {
				return Package{}, fmt.Errorf("archive artifact entry: %w", err)
			}
			result.Artifacts[id] = raw
		case strings.HasPrefix(header.Name, contextDir):
			id, err := sanitizeSegment(strings.TrimPrefix(header.Name, contextDir))
			if err != nil {
				return Package{}, fmt.Errorf("archive context entry: %w", err)
			}
			result.ContextFiles[id] = raw
		default:
			return Package{}, fmt.Errorf("unrecognized chat archive entry %q", header.Name)
		}
	}
	if !manifestSeen {
		return Package{}, errors.New("chat archive package is missing its manifest")
	}
	return result, nil
}

func decodeEventsJSONL(raw []byte) ([]domain.Event, error) {
	var events []domain.Event
	for _, line := range strings.Split(strings.TrimRight(string(raw), "\n"), "\n") {
		if line == "" {
			continue
		}
		var event domain.Event
		if err := json.Unmarshal([]byte(line), &event); err != nil {
			return nil, fmt.Errorf("decode archived event line: %w", err)
		}
		events = append(events, event)
	}
	return events, nil
}
