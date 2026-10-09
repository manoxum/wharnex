package residency

import "testing"

func TestDemotesLeastRecentlyUsedBeyondBudget(t *testing.T) {
	cache := New(2, 100)
	cache.Promote("a", 10)
	cache.Promote("b", 10)
	cache.Touch("a")
	if demoted := cache.Promote("c", 10); len(demoted) != 1 || demoted[0] != "b" {
		t.Fatalf("expected the least recently used session to be demoted, got %v", demoted)
	}
	cache.SetLimits(2, 15)
	if demoted := cache.Promote("d", 10); len(demoted) != 2 || !cache.Hot("d") {
		t.Fatalf("the byte budget must demote older sessions but keep the promoted one, got %v", demoted)
	}
}

func TestOversizedSessionCannotPinCacheOrEvictSmallSessions(t *testing.T) {
	cache := New(24, 64)
	cache.Promote("small", 8)
	if demoted := cache.Promote("large", 65); len(demoted) != 1 || demoted[0] != "large" {
		t.Fatalf("oversized session must be demoted, got %v", demoted)
	}
	if cache.Hot("large") || !cache.Hot("small") || cache.bytes != 8 {
		t.Fatalf("oversized admission retained data or displaced useful data: bytes=%d", cache.bytes)
	}
}

func TestOversizedRefreshRemovesPreviousResidentVersion(t *testing.T) {
	cache := New(2, 16)
	cache.Promote("same", 8)
	cache.Promote("same", 17)
	if cache.Hot("same") || cache.bytes != 0 || cache.order.Len() != 0 {
		t.Fatal("oversized refresh must forget the formerly cached aggregate")
	}
}

func TestCacheResetAndDisabledPosture(t *testing.T) {
	var disabled *Cache
	if !disabled.Hot("a") || len(disabled.Promote("a", 100)) != 0 {
		t.Fatal("disabled cache must retain whole sessions")
	}
	disabled.Touch("a")
	disabled.Forget("a")
	disabled.Reset()
	cache := New(2, 16)
	cache.Promote("a", 8)
	cache.Reset()
	if cache.Hot("a") || cache.bytes != 0 {
		t.Fatal("reset retained entries")
	}
}
