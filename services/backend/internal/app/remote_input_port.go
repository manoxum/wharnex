package app

import (
	"context"
	"time"

	"kernl.local/harness/backend/internal/app/remotemap"
	"kernl.local/harness/backend/internal/domain"
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

type TunnelProviderDescriptor struct {
	ID          string               `json:"id"`
	Name        string               `json:"name"`
	Description string               `json:"description"`
	AuthMode    string               `json:"auth_mode"`
	AuthURL     string               `json:"auth_url,omitempty"`
	Permanent   bool                 `json:"permanent_dns"`
	Available   bool                 `json:"available"`
	Fields      []RemoteStorageField `json:"fields"`
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
	ID        string            `json:"id"`
	Provider  string            `json:"provider"`
	Priority  int               `json:"priority"`
	Available bool              `json:"available"`
	State     string            `json:"state"`
	PublicURL string            `json:"public_url,omitempty"`
	Error     string            `json:"error,omitempty"`
	Limits    RemoteInputLimits `json:"limits"`
	Usage     RemoteInputUsage  `json:"usage"`
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

// RemoteInputReloader is implemented by transports whose instance pool is
// built from saved configuration, so a configuration change can be adopted
// without restarting the process. Durable object stores do not implement it.
type RemoteInputReloader interface {
	ReloadRemoteInput(context.Context) error
}

// RemoteInputController exposes operator lifecycle control for one configured tunnel.
type RemoteInputController interface {
	ControlRemoteInput(context.Context, string, string) error
}

// RemoteInputLeaseStore is optional because durable object stores do not need
// a request-scoped transport lifetime. Quick Tunnel providers use it to keep
// their endpoint alive until the matching request is terminal.
type RemoteInputLeaseStore interface {
	RetainRemoteInput(instanceID, objectName string) error
	ReleaseRemoteInput(instanceID, objectName string) error
}

// RemoteInputChannelStore is implemented by transient providers capable of
// exposing several request resources below one unguessable request namespace.
// Durable object stores continue to use RemoteInputStore unchanged.
type RemoteInputChannelStore interface {
	SupportsRemoteInputChannels() bool
	PublishRemoteInputChannel(context.Context, RemoteInputChannel) (RemoteInputPublication, error)
	UpdateRemoteInputChannel(context.Context, string, RemoteInputChannelUpdate) error
	CloseRemoteInputChannel(context.Context, string, string) error
}

// RemoteInputChannelSetStore publishes the same immutable request namespace
// through every eligible tunnel in priority order. It is optional so existing
// single-provider adapters remain compatible.
type RemoteInputChannelSetStore interface {
	PublishRemoteInputChannelSet(context.Context, RemoteInputChannel) ([]RemoteInputPublication, error)
	UpdateRemoteInputChannelSet(context.Context, []string, RemoteInputChannelUpdate) error
	CloseRemoteInputChannelSet(context.Context, []string, string) error
}

// RemoteInputSessionStore owns transient transport infrastructure shared by
// all chats for the lifetime of one running Wharnex backend session.
type RemoteInputSessionStore interface {
	StartRemoteInputSession(context.Context) error
	StopRemoteInputSession(context.Context) error
	ClearRemoteInputSession(context.Context) error
}

type RemoteInputChannel struct {
	ChannelID   string
	InstanceIDs []string
	RootRequest string
	Resources   []RemoteInputChannelResource
	Bytes       int64
	FileCount   int
	MaxFileSize int64
}

type RemoteInputChannelResource = remotemap.Resource

type RemoteInputChannelUpdate struct {
	ChannelID string
	Resources []RemoteInputChannelResource
	Event     string
	Data      map[string]string
}

type RemoteInputFile struct {
	Name          string `json:"name"`
	MIME          string `json:"mime,omitempty"`
	ContentBase64 string `json:"content_base64"`
}

type RemoteInputRequest struct {
	RequestID         string             `json:"request_id"`
	Prompt            string             `json:"prompt"`
	BootstrapText     string             `json:"bootstrap_text"`
	IncludeContext    bool               `json:"include_context"`
	ContextMode       domain.ContextMode `json:"-"`
	ContextPaths      []string           `json:"-"`
	ContextRound      int                `json:"-"`
	Attachments       []RemoteInputFile  `json:"attachments"`
	Artifacts         []RemoteInputFile  `json:"artifacts"`
	ProjectFiles      []string           `json:"project_files"`
	TunnelInstanceIDs []string           `json:"tunnel_instance_ids"`
	RequestMetadata   RequestMetadata    `json:"request_metadata"`
}

type RequestMetadata struct {
	Protocol    string `json:"protocol"`
	ChatTitle   string `json:"chat_title"`
	ChatID      string `json:"chat_id"`
	ChatHash    string `json:"chat_hash"`
	RequestedAt string `json:"requested_at"`
}

type RemoteInputResult struct {
	Mode            string              `json:"mode"`
	Provider        string              `json:"provider"`
	InstanceID      string              `json:"instance_id"`
	BootstrapPrompt string              `json:"bootstrap_prompt"`
	SHA256          string              `json:"sha256"`
	Bytes           int64               `json:"bytes"`
	ExpiresAt       time.Time           `json:"expires_at"`
	IncludedContext bool                `json:"included_context"`
	FallbackPrompt  string              `json:"fallback_prompt,omitempty"`
	Tunnels         []RemoteInputTunnel `json:"tunnels,omitempty"`
}

type RemoteInputTunnel struct {
	Provider   string `json:"provider"`
	InstanceID string `json:"instance_id"`
	Manifest   string `json:"manifest"`
	Status     string `json:"status"`
}
