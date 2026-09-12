package audit

import (
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/domain"
)

type memoryEventStore struct{ events []domain.Event }

func (s *memoryEventStore) AppendEvent(event domain.Event) error {
	s.events = append(s.events, event)
	return nil
}

func (s *memoryEventStore) EventHistory(sessionID string) ([]domain.Event, error) {
	var result []domain.Event
	for _, event := range s.events {
		if event.SessionID == sessionID {
			result = append(result, event)
		}
	}
	return result, nil
}

func TestPublishAndHistory(t *testing.T) {
	bus := NewBus()
	bus.Publish("s1", "session.created", map[string]any{"ok": true})
	items := bus.History("s1")
	if len(items) != 1 || items[0].Type != "session.created" {
		t.Fatalf("unexpected history: %#v", items)
	}
}

func TestPersistentBusRestoresBoundedRedactedHistory(t *testing.T) {
	store := &memoryEventStore{}
	bus := NewPersistentBus(store)
	bus.Publish("s1", "command.completed", map[string]any{"stdout": "ok", "token": "must-not-leak"})
	restarted := NewPersistentBus(store)
	items := restarted.History("s1")
	if len(items) != 1 || items[0].Data["token"] != "[REDACTED]" {
		t.Fatalf("persistent redacted history unavailable: %#v", items)
	}
}

// Decoded JSON puts objects inside []any, and without traversing that case
// neither redaction nor the length bound reached them — which is exactly the
// shape a plan's operations and an execution's per-command output arrive in.
func TestSanitizeTraversesNestedArrays(t *testing.T) {
	bus := NewBus()
	event := bus.Publish("ses-1", "execution.recorded", map[string]any{
		"execution": map[string]any{
			"commands": []any{
				map[string]any{"stdout": "api_key=super-secret-value", "stderr": strings.Repeat("x", 9000)},
			},
		},
	})
	execution, ok := event.Data["execution"].(map[string]any)
	if !ok {
		t.Fatalf("execution payload missing: %#v", event.Data)
	}
	commands, ok := execution["commands"].([]any)
	if !ok || len(commands) != 1 {
		t.Fatalf("commands payload missing: %#v", execution)
	}
	command, ok := commands[0].(map[string]any)
	if !ok {
		t.Fatalf("command payload missing: %#v", commands[0])
	}
	if stdout, _ := command["stdout"].(string); !strings.Contains(stdout, "[REDACTED]") {
		t.Fatalf("a credential inside a nested array must be redacted, got %q", stdout)
	}
	if stderr, _ := command["stderr"].(string); !strings.HasSuffix(stderr, "…[truncated]") {
		t.Fatalf("a long string inside a nested array must be bounded, got %d bytes", len(stderr))
	}
}
