package app

import (
	"context"
	"time"
)

// A remote route is optional because the canonical request ZIP is always
// attached directly. Bound the entire publication so an unavailable provider
// cannot retain the request (or the tunnel pool mutex) indefinitely.
const remoteInputPublicationTimeout = 16 * time.Second

func boundedRemoteInputPublicationContext(parent context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(parent, remoteInputPublicationTimeout)
}
