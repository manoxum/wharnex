// Package chatarchive packs a session's backend-owned artifacts, audit
// events and on-disk context archive files into one tar stream compressed
// with a single zstd pass, and unpacks that stream back. It performs no I/O
// against MinIO/Postgres itself (see ADR-0031) — the internal/app orchestrator
// owns fetching/storing bytes; this package only owns the wire format, so it
// stays independently unit-testable with no fakes.
package chatarchive

import (
	"time"

	"kernl.local/harness/backend/internal/domain"
)

// FormatVersion guards forward/backward compatibility of the manifest shape.
// Bump it if the tar layout or manifest fields ever change incompatibly.
const FormatVersion = 1

// Manifest is the package's own table of contents, written as manifest.json.
// Artifacts reuses domain.ArtifactRecord directly: its ObjectKey field is
// already json:"-", so embedding it here never leaks the (now-deleted)
// original MinIO key.
type Manifest struct {
	FormatVersion int                     `json:"format_version"`
	SessionID     string                  `json:"session_id"`
	CreatedAt     time.Time               `json:"created_at"`
	Artifacts     []domain.ArtifactRecord `json:"artifacts"`
	ContextFiles  []string                `json:"context_files"`
}

// Package is the fully decoded result of Unpack.
type Package struct {
	Manifest     Manifest
	Events       []domain.Event
	Artifacts    map[string][]byte // keyed by ArtifactRecord.ID
	ContextFiles map[string][]byte // keyed by the original request id
}
