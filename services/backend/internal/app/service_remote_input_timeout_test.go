package app

import (
	"context"
	"testing"
	"time"
)

func TestRemoteInputPublicationContextHasBoundedDeadline(t *testing.T) {
	ctx, cancel := boundedRemoteInputPublicationContext(context.Background())
	defer cancel()
	deadline, ok := ctx.Deadline()
	if !ok {
		t.Fatal("remote input publication context has no deadline")
	}
	remaining := time.Until(deadline)
	if remaining <= 0 || remaining > remoteInputPublicationTimeout {
		t.Fatalf("unexpected publication deadline remaining: %s", remaining)
	}
}
