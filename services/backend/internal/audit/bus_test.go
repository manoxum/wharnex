package audit

import "testing"

func TestPublishAndHistory(t *testing.T) {
	bus := NewBus()
	bus.Publish("s1", "session.created", map[string]any{"ok": true})
	items := bus.History("s1")
	if len(items) != 1 || items[0].Type != "session.created" {
		t.Fatalf("unexpected history: %#v", items)
	}
}
