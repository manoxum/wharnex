package session

import (
	"strings"
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

func TestEveryChatAgentRateLimitPausesForFiveMinutes(t *testing.T) {
	store := NewStore()
	for index := range 5 {
		before := time.Now().UTC()
		state, err := store.RecordChatAgentRateLimit("conversation_transport", ChatAgentRateLimitTransport)
		if err != nil {
			t.Fatal(err)
		}
		if state.RateLimitLevel != min(index+1, 4) || state.PausedUntil == nil {
			t.Fatalf("level %d state=%#v", index+1, state)
		}
		got := state.PausedUntil.Sub(before)
		if got < chatAgentRateLimitGatePause-time.Second || got > chatAgentRateLimitGatePause+time.Second {
			t.Fatalf("pause level %d=%v want about %v", index+1, got, chatAgentRateLimitGatePause)
		}
	}
}

// The incident this covers: workers kept claiming and submitting straight into
// ChatGPT's account-wide "too many requests" block, because the only response
// available was the transport ladder, whose first step is one minute.
func TestChatAgentRateLimitGateSuspendsProviderForFiveMinutes(t *testing.T) {
	store := NewStore()
	before := time.Now().UTC()
	state, err := store.RecordChatAgentRateLimit("dom_gate", ChatAgentRateLimitGate)
	if err != nil {
		t.Fatal(err)
	}
	if !state.Paused || state.PausedUntil == nil {
		t.Fatalf("gate did not pause the provider: %#v", state)
	}
	got := state.PausedUntil.Sub(before)
	if got < chatAgentRateLimitGatePause-time.Second || got > chatAgentRateLimitGatePause+time.Second {
		t.Fatalf("gate pause=%v want about %v", got, chatAgentRateLimitGatePause)
	}
	// Pinned at the ceiling so the navigation gate resumes protective, not healthy.
	if state.RateLimitLevel != chatAgentMaxRateLimitLevel {
		t.Fatalf("gate level=%d want %d", state.RateLimitLevel, chatAgentMaxRateLimitLevel)
	}
	if !strings.Contains(state.Reason, "gate") {
		t.Fatalf("gate reason=%q", state.Reason)
	}
}

// A transport 429 observed during the gate's countdown must not shorten the
// suspension to its own five-minute ladder step.
func TestChatAgentTransportRateLimitNeverShortensAnActiveGate(t *testing.T) {
	store := NewStore()
	gate, err := store.RecordChatAgentRateLimit("dom_gate", ChatAgentRateLimitGate)
	if err != nil {
		t.Fatal(err)
	}
	after, err := store.RecordChatAgentRateLimit("conversation_transport", ChatAgentRateLimitTransport)
	if err != nil {
		t.Fatal(err)
	}
	if after.PausedUntil == nil || after.PausedUntil.Before(*gate.PausedUntil) {
		t.Fatalf("transport 429 shortened the gate: gate=%v after=%v", gate.PausedUntil, after.PausedUntil)
	}
}

func TestChatAgentExpiredGateResumesAtTheHealthyRateLimitLevel(t *testing.T) {
	past := time.Now().UTC().Add(-time.Second)
	store := NewStore()
	store.chatAgentProvider = ChatAgentProviderState{
		Provider: "chatgpt", Paused: true, PausedUntil: &past, Reason: "gate",
		RateLimitLevel: chatAgentMaxRateLimitLevel, LastRateLimitAt: &past, LastRateLimitSource: "dom_gate",
	}
	state, err := store.ChatAgentProviderState()
	if err != nil {
		t.Fatal(err)
	}
	if state.Paused || state.PausedUntil != nil || state.RateLimitLevel != 0 || state.LastRateLimitAt != nil || state.LastRateLimitSource != "" {
		t.Fatalf("expired gate did not reset the provider state: %#v", state)
	}
}

func TestChatAgentRateLimitKindDefaultsToTransport(t *testing.T) {
	store := NewStore()
	before := time.Now().UTC()
	state, err := store.RecordChatAgentRateLimit("main_frame", "")
	if err != nil {
		t.Fatal(err)
	}
	if state.PausedUntil == nil || state.PausedUntil.Sub(before) < chatAgentRateLimitGatePause-time.Second {
		t.Fatalf("unknown kind did not fall back to the five-minute transport pause: %#v", state)
	}
}

// Diagnosing the orchestrator stall was blocked by exactly this: four planning
// requests sat at attempt 3/8 and 7/8 reporting only "ChatGPT rate-limit
// cooldown is active", a note written by leases that attempted nothing, while
// the failures that actually spent those attempts had each been overwritten.
func TestObservationNoteNeverOverwritesARealFailure(t *testing.T) {
	const realFailure = "ChatGPT did not provide whx_orchestrator_plan_cat_x.json before the timeout"
	if got := chatAgentTransitionError(realFailure, "ChatGPT rate-limit cooldown is active", ChatAgentTaskWaiting, true); got != realFailure {
		t.Fatalf("observation overwrote the real failure: %q", got)
	}
	// An empty field still records why the task is waiting.
	if got := chatAgentTransitionError("", "ChatGPT rate-limit cooldown is active", ChatAgentTaskWaiting, false); got != "ChatGPT rate-limit cooldown is active" {
		t.Fatalf("waiting note was dropped: %q", got)
	}
	if got := chatAgentTransitionError("", "cooldown", ChatAgentTaskWaiting, true); got != "cooldown" {
		t.Fatalf("observation must fill an empty field: %q", got)
	}
	// Another real outcome always replaces it, so the field cannot go stale.
	if got := chatAgentTransitionError(realFailure, "composer unavailable", ChatAgentTaskWaiting, false); got != "composer unavailable" {
		t.Fatalf("a real failure must replace the previous one: %q", got)
	}
	if got := chatAgentTransitionError(realFailure, "", ChatAgentTaskFailed, false); got != "" {
		t.Fatalf("terminal transitions own the field: %q", got)
	}
}
