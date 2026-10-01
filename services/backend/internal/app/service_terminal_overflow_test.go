package app

import "testing"

func TestTerminalOutputOverflowClosesSubscriberForReplay(t *testing.T) {
	subscriber := make(chan TerminalFrame, 1)
	state := &terminalSessionState{subscribers: map[chan TerminalFrame]struct{}{subscriber: {}}}
	state.publish(TerminalFrame{Type: "output", Data: "first"})
	state.publish(TerminalFrame{Type: "output", Data: "second"})
	if len(state.subscribers) != 0 {
		t.Fatal("slow subscriber remained attached after losing output")
	}
	<-subscriber
	if _, open := <-subscriber; open {
		t.Fatal("overflowed stream remained open")
	}
	if len(state.frames) != 2 {
		t.Fatalf("replay lost output: %d frames", len(state.frames))
	}
}

func TestTerminalReplayStartsReadyAfterOutputEvictsOriginalFrame(t *testing.T) {
	state := &terminalSessionState{sessionID: "session", target: "host", frames: []TerminalFrame{{Type: "output", Data: "recent"}}, subscribers: make(map[chan TerminalFrame]struct{})}
	service := &Service{terminals: map[string]*terminalSessionState{"pty_test": state}}
	replay, _, cancel, err := service.SubscribeInteractiveTerminal("session", "pty_test")
	if err != nil {
		t.Fatal(err)
	}
	defer cancel()
	if len(replay) != 2 || replay[0].Type != "ready" || replay[1].Data != "recent" {
		t.Fatalf("replay = %#v", replay)
	}
}
