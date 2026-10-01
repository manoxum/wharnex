package domain

import "time"

type RequestSupportArtifact struct {
	Path    string `json:"path"`
	Content []byte `json:"content"`
}

// InterruptedExecution is a durable execution intent. Its presence means the
// process disappeared or its caller disconnected before a terminal result was
// persisted, so only an explicit user decision may resume or discard it.
const (
	InterruptedExecutionAwaitingDecision = "awaiting_decision"
	InterruptedExecutionRunning          = "running"
	InterruptedExecutionResuming         = "resuming"
	InterruptedExecutionFailedRetryable  = "failed_retryable"
)

type InterruptedExecution struct {
	PlanID      string    `json:"plan_id"`
	RequestedAt time.Time `json:"requested_at"`
	Approved    bool      `json:"approved"`
	Status      string    `json:"status,omitempty"`
	LastError   string    `json:"last_error,omitempty"`
}

type ArtifactRecord struct {
	ID          string    `json:"id"`
	RequestID   string    `json:"request_id,omitempty"`
	Direction   string    `json:"direction"`
	Kind        string    `json:"kind"`
	Name        string    `json:"name"`
	ContentType string    `json:"content_type,omitempty"`
	Size        int64     `json:"size"`
	SHA256      string    `json:"sha256"`
	ObjectKey   string    `json:"-"`
	CreatedAt   time.Time `json:"created_at"`
	ExpiresAt   time.Time `json:"expires_at"`
	Bundle      bool      `json:"bundle"`
	BundleType  string    `json:"bundle_type,omitempty"`
	EntryCount  int       `json:"entry_count,omitempty"`
}

// ArchivePackageRecord describes the single compacted object a session's
// artifacts/events/context archives were folded into (ADR-0031). ObjectKey
// is server-only, exactly like ArtifactRecord.ObjectKey.
type ArchivePackageRecord struct {
	ObjectKey  string    `json:"-"`
	SHA256     string    `json:"sha256"`
	Size       int64     `json:"size"`
	EntryCount int       `json:"entry_count"`
	CreatedAt  time.Time `json:"created_at"`
}

type ArtifactEntry struct {
	Path string `json:"path"`
	Size int64  `json:"size"`
	Dir  bool   `json:"dir"`
}

type Event struct {
	ID        string         `json:"id"`
	SessionID string         `json:"session_id"`
	Type      string         `json:"type"`
	Timestamp time.Time      `json:"timestamp"`
	Data      map[string]any `json:"data"`
}
