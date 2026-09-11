package session

import (
	"testing"
	"time"
)

func TestChatAgentInitialWaitUsesValidSampleAverage(t *testing.T) {
	cases := []struct {
		average time.Duration
		samples int
		want    time.Duration
	}{
		{2 * time.Minute, 3, 90 * time.Second},
		{10 * time.Minute, 3, 5*time.Minute + 30*time.Second},
		{20 * time.Minute, 3, 10*time.Minute + 30*time.Second},
		{40 * time.Minute, 3, 15 * time.Minute},
		{10 * time.Minute, 2, time.Minute},
	}
	for _, tc := range cases {
		if got := chatAgentInitialWait(tc.average, tc.samples); got != tc.want {
			t.Fatalf("initial wait average=%v samples=%d got=%v want=%v", tc.average, tc.samples, got, tc.want)
		}
	}
}

func TestChatAgentValidBundleSamplesAreBoundedAndDeduplicated(t *testing.T) {
	store := NewStore()
	for index := 0; index < 55; index++ {
		requestID := time.Unix(int64(index+1), 0).UTC().Format(time.RFC3339Nano)
		if _, err := store.RecordChatAgentValidBundle(requestID, "conv", 2*time.Minute); err != nil {
			t.Fatal(err)
		}
	}
	if len(store.chatAgentProcessingSamples) != 50 {
		t.Fatalf("sample count=%d want 50", len(store.chatAgentProcessingSamples))
	}
	last := store.chatAgentProcessingSamples[len(store.chatAgentProcessingSamples)-1]
	if _, err := store.RecordChatAgentValidBundle(last.RequestID, "conv", 9*time.Minute); err != nil {
		t.Fatal(err)
	}
	if len(store.chatAgentProcessingSamples) != 50 {
		t.Fatalf("duplicate changed sample count=%d", len(store.chatAgentProcessingSamples))
	}
	state, err := store.RecordChatAgentValidBundle("valid-without-visible-duration", "conv", 0)
	if err != nil {
		t.Fatal(err)
	}
	if state.ValidSampleCount != 50 || state.InitialWaitMS != (90*time.Second).Milliseconds() {
		t.Fatalf("provider metrics=%#v", state)
	}
}

func TestChatAgentRateLimitBackoffIsProgressive(t *testing.T) {
	store := NewStore()
	want := []time.Duration{time.Minute, 2 * time.Minute, 4 * time.Minute, 5 * time.Minute, 5 * time.Minute}
	for index, pause := range want {
		before := time.Now().UTC()
		state, err := store.RecordChatAgentRateLimit("conversation_transport")
		if err != nil {
			t.Fatal(err)
		}
		if state.RateLimitLevel != min(index+1, 4) || state.PausedUntil == nil {
			t.Fatalf("level %d state=%#v", index+1, state)
		}
		got := state.PausedUntil.Sub(before)
		if got < pause-time.Second || got > pause+time.Second {
			t.Fatalf("pause level %d=%v want about %v", index+1, got, pause)
		}
	}
}
