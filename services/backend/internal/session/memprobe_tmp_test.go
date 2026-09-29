package session

import (
	"context"
	"os"
	"runtime"
	"testing"
)

func TestMemProbeTmp(t *testing.T) {
	url := os.Getenv("MEMPROBE_URL")
	if url == "" {
		t.Skip()
	}
	measure := func(name string, load func(*Store) int) {
		runtime.GC()
		var before, after runtime.MemStats
		runtime.ReadMemStats(&before)
		store, err := NewPostgresStore(context.Background(), url, "")
		if err != nil {
			t.Fatal(err)
		}
		n := load(store)
		runtime.GC()
		runtime.ReadMemStats(&after)
		t.Logf("%s: sessions=%d live heap=%d MiB (peak sys=%d MiB)", name, n, (after.HeapAlloc-before.HeapAlloc)>>20, after.HeapSys>>20)
		runtime.KeepAlive(store)
		store.Close()
	}
	measure("tiered (new)", func(s *Store) int { return len(s.List()) })
	measure("all whole (old)", func(s *Store) int {
		s.mu.Lock()
		s.tier.maxItems, s.tier.maxBytes = 1<<30, 1<<62
		for id := range s.items {
			if _, err := s.residentLocked(id); err != nil {
				t.Fatal(err)
			}
		}
		s.mu.Unlock()
		return len(s.List())
	})
}
