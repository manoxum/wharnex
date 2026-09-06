package remoteinput

import (
	"context"
	"errors"
	"regexp"
	"time"

	"kernl.local/harness/backend/internal/app"
)

type Publication struct {
	Provider       string
	URL            string
	ExpiresAt      time.Time
	CleanupWarning string
}

var objectNamePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,239}$`)

func validateObjectName(value string) error {
	if !objectNamePattern.MatchString(value) || value == "." || value == ".." {
		return errors.New("invalid remote object name")
	}
	return nil
}

type Provider interface {
	Name() string
	Put(ctx context.Context, objectName, filePath string) (Publication, error)
	Delete(ctx context.Context, objectName string) error
}

// RequestLeaseProvider keeps a transient transport endpoint alive while a
// published Wharness request is awaiting its terminal bundle. Providers that
// do not own a transient endpoint simply do not implement this optional port.
type RequestLeaseProvider interface {
	Retain(objectName string) error
	Release(objectName string) error
}

// ChannelProvider exposes a request-scoped collection through one transient
// endpoint. Resource paths are adapter-owned, read-only and strictly validated.
type ChannelProvider interface {
	PublishChannel(context.Context, app.RemoteInputChannel) (Publication, error)
	UpdateChannel(context.Context, app.RemoteInputChannelUpdate) error
	CloseChannel(context.Context, string) error
}

// SessionProvider owns transport infrastructure shared across request
// channels and releases it only when the Wharness runtime session ends.
type SessionProvider interface {
	StartSession(context.Context) error
	StopSession(context.Context) error
	ClearSession(context.Context) error
}
