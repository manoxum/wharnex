package audit

import (
	"testing"

	"kernl.local/harness/backend/internal/domain"
)

func TestObserverSeesEveryPublishedEventAlreadyRedacted(t *testing.T) {
	bus := NewBus()
	var seen []domain.Event
	bus.SetObserver(func(event domain.Event) { seen = append(seen, event) })
	bus.Publish("ses_1", "execution.failed", map[string]any{"api_token": "abc"})
	bus.SetObserver(nil)
	bus.Publish("ses_1", "execution.started", nil)
	if len(seen) != 1 || seen[0].Type != "execution.failed" || seen[0].Data["api_token"] != "[REDACTED]" {
		t.Fatalf("observer must see each event once, after redaction: %#v", seen)
	}
}
