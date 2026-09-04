package app

import (
	"context"
	"time"
)

const RemoteInputRetention = 7 * 24 * time.Hour

type RemoteInputPublication struct {
	Provider       string
	InstanceID     string
	URL            string
	ExpiresAt      time.Time
	CleanupWarning string
}

type RemoteInputStatus struct {
	Enabled   bool                        `json:"enabled"`
	Provider  string                      `json:"provider,omitempty"`
	Mode      string                      `json:"mode"`
	Instances []RemoteInputInstanceStatus `json:"instances,omitempty"`
}

type RemoteInputLimits struct {
	MaxRequests      int   `json:"max_requests"`
	WindowSeconds    int   `json:"window_seconds"`
	MaxFiles         int   `json:"max_files_per_input"`
	MaxFileBytes     int64 `json:"max_file_bytes"`
	MaxInputBytes    int64 `json:"max_input_bytes"`
	MaxStoredObjects int   `json:"max_stored_objects"`
	MaxStorageBytes  int64 `json:"max_storage_bytes"`
}

type RemoteInputUsage struct {
	RequestsInWindow int   `json:"requests_in_window"`
	StoredObjects    int   `json:"stored_objects"`
	StorageBytes     int64 `json:"storage_bytes"`
}

type RemoteInputInstanceStatus struct {
	ID       string            `json:"id"`
	Provider string            `json:"provider"`
	Priority int               `json:"priority"`
	Limits   RemoteInputLimits `json:"limits"`
	Usage    RemoteInputUsage  `json:"usage"`
}

type RemoteInputObject struct {
	ObjectName  string
	FilePath    string
	Bytes       int64
	FileCount   int
	MaxFileSize int64
}

type RemoteInputStore interface {
	Publish(context.Context, RemoteInputObject) (RemoteInputPublication, error)
	Status() RemoteInputStatus
}

type RemoteInputFile struct {
	Name          string `json:"name"`
	MIME          string `json:"mime,omitempty"`
	ContentBase64 string `json:"content_base64"`
}

type RemoteInputRequest struct {
	RequestID      string            `json:"request_id"`
	Prompt         string            `json:"prompt"`
	IncludeContext bool              `json:"include_context"`
	Attachments    []RemoteInputFile `json:"attachments"`
	Artifacts      []RemoteInputFile `json:"artifacts"`
}

type RemoteInputResult struct {
	Mode            string    `json:"mode"`
	Provider        string    `json:"provider"`
	InstanceID      string    `json:"instance_id"`
	BootstrapPrompt string    `json:"bootstrap_prompt"`
	SHA256          string    `json:"sha256"`
	Bytes           int64     `json:"bytes"`
	ExpiresAt       time.Time `json:"expires_at"`
	IncludedContext bool      `json:"included_context"`
}
