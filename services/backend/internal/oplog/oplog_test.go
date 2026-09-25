package oplog

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"

	"kernl.local/harness/backend/internal/domain"
)

func TestClassifyDerivesComponentLevelAndCategoryFromTheEventName(t *testing.T) {
	cases := map[string][3]string{
		"execution.failed":                     {"execution", LevelError, "execution"},
		"integration.merge_preflight_conflict": {"integration", LevelWarning, "integration"},
		"self_evolution.activation_abandoned":  {"self_evolution", LevelWarning, "self_evolution"},
		"artifact.persisted":                   {"artifact", LevelSuccess, "request"},
		"host.apply_started":                   {"host", LevelInfo, "integration"},
		"command.output":                       {"command", LevelDebug, "execution"},
		"chatgpt-upload":                       {"chatgpt-upload", LevelInfo, "transport"},
		"Some Weird/Name":                      {"someweirdname", LevelInfo, "other"},
	}
	for event, want := range cases {
		component, level, category := Classify(event)
		if [3]string{component, level, category} != want {
			t.Errorf("Classify(%q) = %q %q %q, want %v", event, component, level, category, want)
		}
	}
}

func TestNormalizeRedactsBoundsAndClassifiesEveryRecord(t *testing.T) {
	now := time.Date(2026, 9, 25, 18, 0, 0, 0, time.UTC)
	record := Record{
		Source: "anything", Event: "execution.failed", Level: "loud", OccurredAt: now.Add(time.Hour),
		Message: "token=abc123 " + strings.Repeat("x", 5000),
		Data:    map[string]any{"api_key": "secret-value", "note": "password: hunter2"},
	}
	record.Normalize(now)
	if record.ID == "" || !record.OccurredAt.Equal(now) || record.Source != SourceBackend {
		t.Fatalf("defaults not applied: %#v", record)
	}
	if record.Level != LevelError || record.Component != "execution" || record.Category != "execution" {
		t.Fatalf("classification not derived: %#v", record)
	}
	if strings.Contains(record.Message, "abc123") || len(record.Message) > 2010 {
		t.Fatalf("message was not redacted and bounded: %d bytes", len(record.Message))
	}
	if record.Data["api_key"] != "[REDACTED]" || strings.Contains(record.Data["note"].(string), "hunter2") {
		t.Fatalf("data was not redacted: %#v", record.Data)
	}
	huge := Record{Event: "x", Data: map[string]any{"blob": strings.Repeat("y", 8000), "blob2": strings.Repeat("z", 8000), "blob3": strings.Repeat("w", 8000)}}
	huge.Normalize(now)
	if huge.Data["truncated"] != true {
		t.Fatalf("oversized data must be replaced by a truncation marker: %#v", huge.Data)
	}
}

func TestFromEventReferencesTheEventAndCopiesOnlyCorrelationAndScalars(t *testing.T) {
	event := domain.Event{ID: "evt_1", SessionID: "ses_1", Type: "execution.recorded", Timestamp: time.Now(), Data: map[string]any{
		"request_id": "req_1", "chat_id": "chat_1", "plan_id": "plan_1", "error": "boom",
		"execution": map[string]any{"commands": []any{"huge"}}, "long": strings.Repeat("a", 400), "exit_code": 2,
	}}
	record := FromEvent(event)
	if record.EventRef != "evt_1" || record.RequestID != "req_1" || record.ChatID != "chat_1" || record.PlanID != "plan_1" || record.Message != "boom" {
		t.Fatalf("correlation not copied: %#v", record)
	}
	if _, ok := record.Data["execution"]; ok {
		t.Fatal("the complete body must stay in harness_events and be referenced, not copied")
	}
	if _, ok := record.Data["long"]; ok || record.Data["exit_code"] != 2 {
		t.Fatalf("only small scalars may be copied: %#v", record.Data)
	}
}

func TestFilterRendersOnlyParameterizedClauses(t *testing.T) {
	where, args := Filter{RequestID: "req_1'; drop table x;--", MinLevel: LevelWarning, Search: "50%_off"}.SQL()
	if strings.Contains(where, "drop table") || strings.Contains(where, "req_1") {
		t.Fatalf("values must travel as arguments: %s", where)
	}
	if len(args) != 3 || !strings.Contains(where, "level = ANY(") {
		t.Fatalf("unexpected clause: %s %#v", where, args)
	}
	if (Filter{Limit: 999999}).BoundedLimit() != maxQueryLimit || (Filter{}).BoundedLimit() != 200 {
		t.Fatal("page size must be bounded")
	}
}

func TestRetentionNeverKeepsAnythingPastFifteenDays(t *testing.T) {
	now := time.Date(2026, 9, 25, 0, 0, 0, 0, time.UTC)
	verbose, ordinary := RetentionCutoffs(now)
	if now.Sub(verbose) != 3*24*time.Hour || now.Sub(ordinary) != 15*24*time.Hour {
		t.Fatalf("unexpected cutoffs: %v %v", verbose, ordinary)
	}
}

type memoryStore struct {
	mu      sync.Mutex
	batches [][]Record
	block   chan struct{}
}

func (m *memoryStore) AppendOperationalLog(_ context.Context, records []Record) error {
	if m.block != nil {
		<-m.block
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.batches = append(m.batches, append([]Record(nil), records...))
	return nil
}

func (m *memoryStore) all() []Record {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []Record
	for _, batch := range m.batches {
		out = append(out, batch...)
	}
	return out
}

func TestWriterFlushesOnCloseAndCapturesStandardLogLines(t *testing.T) {
	store := &memoryStore{}
	writer := NewWriter(store, 0)
	writer.Emit(Record{Event: "host.apply_started"})
	_, _ = writer.StdLog().Write([]byte("chat agent task retention sweep failed: boom\nsecond line\n"))
	writer.Close()
	writer.Emit(Record{Event: "late"}) // must not panic after Close
	records := store.all()
	if len(records) != 3 {
		t.Fatalf("expected 3 flushed records, got %d", len(records))
	}
	if records[1].Component != "backend-log" || records[1].Level != LevelError || records[2].Level != LevelInfo {
		t.Fatalf("standard log lines not classified: %#v", records[1:])
	}
}

func TestWriterNeverBlocksTheEngineWhenTheStoreIsStuck(t *testing.T) {
	store := &memoryStore{block: make(chan struct{})}
	writer := NewWriter(store, batchSize)
	started := time.Now()
	for i := 0; i < batchSize*5; i++ {
		writer.Emit(Record{Event: "command.output"})
	}
	if time.Since(started) > time.Second {
		t.Fatal("Emit blocked on a stuck store")
	}
	if writer.Dropped() == 0 {
		t.Fatal("a full buffer must drop and count instead of blocking")
	}
	close(store.block)
	writer.Close()
}
