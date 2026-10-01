package gitlive

import (
	"context"
	"sync/atomic"
	"testing"
	"time"
)

func TestHubSharesProjectObserverAndStopsAfterLastStream(t *testing.T) {
	var revision atomic.Uint32
	var samples atomic.Int32
	ready := make(chan struct{}, 1)
	notified := make(chan string, 4)
	hub := NewHub(5*time.Millisecond, func(_ context.Context, _ string) (map[string][32]byte, error) {
		samples.Add(1)
		select {
		case ready <- struct{}{}:
		default:
		}
		var signature [32]byte
		signature[0] = byte(revision.Load())
		return map[string][32]byte{"": signature}, nil
	}, func(sessionID string) { notified <- sessionID })
	releaseOne := hub.Acquire("/project", "ses-one")
	<-ready
	releaseTwo := hub.Acquire("/project", "ses-two")
	if len(hub.watches) != 1 {
		t.Fatalf("observers = %d", len(hub.watches))
	}
	seen := map[string]bool{}
	for len(seen) < 2 {
		select {
		case id := <-notified:
			seen[id] = true
		case <-time.After(time.Second):
			t.Fatalf("missing notifications: %v", seen)
		}
	}
	if !seen["ses-one"] || !seen["ses-two"] {
		t.Fatalf("wrong sessions: %v", seen)
	}
	// A first successful sample confirms the state for each newly attached
	// stream; a change during stream setup cannot disappear into the baseline.
	revision.Store(1)
	seen = map[string]bool{}
	for len(seen) < 2 {
		select {
		case id := <-notified:
			seen[id] = true
		case <-time.After(time.Second):
			t.Fatalf("missing change notifications: %v", seen)
		}
	}
	releaseOne()
	releaseOne()
	releaseTwo()
	if len(hub.watches) != 0 {
		t.Fatalf("observer retained after release: %d", len(hub.watches))
	}
	before := samples.Load()
	time.Sleep(25 * time.Millisecond)
	if after := samples.Load(); after > before+1 {
		t.Fatalf("observer kept sampling: %d -> %d", before, after)
	}
}
