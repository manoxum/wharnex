package transcript

import (
	"testing"
	"time"

	"kernl.local/harness/backend/internal/domain"
)

func entry(id, request string, owned bool) domain.WorkspaceChatItem {
	return domain.WorkspaceChatItem{ID: id, ChatID: "chat", CreatedAt: time.Unix(1, 0), Payload: map[string]any{
		"id": id, "role": "user", "text": "same text", Owned: owned,
		"iteration": map[string]any{"phase": "outbound", "requestId": request},
	}}
}

func TestStaleRendererReplacementRetainsBackendOwnedHistory(t *testing.T) {
	got := Merge([]domain.WorkspaceChatItem{entry("api", "req", true), entry("renderer", "", false)}, nil, false)
	if len(got) != 1 || got[0].ID != "api" {
		t.Fatalf("backend prompt lost or renderer shrink broken: %#v", got)
	}
}

func TestOptimisticRequestConvergesWithoutLosingRendererAttachments(t *testing.T) {
	api := entry("api", "req", true)
	ui := entry("ui", "req", false)
	ui.Payload["attachments"] = []any{"local attachment"}
	got := Merge([]domain.WorkspaceChatItem{api}, []domain.WorkspaceChatItem{ui}, false)
	if len(got) != 1 || got[0].ID != "ui" || got[0].Payload[Owned] != true || got[0].Payload["attachments"] == nil {
		t.Fatalf("optimistic request failed to converge: %#v", got)
	}
	if len(Merge(got, nil, false)) != 1 {
		t.Fatal("a stale snapshot erased the reconciled backend prompt")
	}
}

func TestAppendIsIdempotentAndKeepsEqualTextDistinctRequests(t *testing.T) {
	first, second := entry("first", "req1", true), entry("second", "req2", true)
	got := Merge([]domain.WorkspaceChatItem{first}, []domain.WorkspaceChatItem{second}, true)
	got = Merge(got, []domain.WorkspaceChatItem{second}, true)
	if len(got) != 2 {
		t.Fatalf("append duplicated retry or collapsed distinct requests: %#v", got)
	}
	if !got[0].CreatedAt.Equal(first.CreatedAt) || !got[1].CreatedAt.Equal(second.CreatedAt) {
		t.Fatal("an append retry changed an existing entry's timestamp")
	}
}

func TestRendererCannotReplaceOriginalInputWithBoundedEventText(t *testing.T) {
	original := entry("api", "req", true)
	event := entry("api", "req", true)
	event.Payload["text"] = "bounded event preview"
	got := Merge([]domain.WorkspaceChatItem{original}, []domain.WorkspaceChatItem{event}, false)
	if len(got) != 1 || got[0].Payload["text"] != original.Payload["text"] {
		t.Fatalf("event projection replaced the original request text: %#v", got)
	}
}

func TestRendererSnapshotConvergesBothCorrelatedUserIdentities(t *testing.T) {
	api, ui := entry("request:req", "req", true), entry("ui", "req", false)
	ui.Payload["attachments"] = []any{"notes"}
	for _, incoming := range [][]domain.WorkspaceChatItem{{api, ui}, {ui, api}} {
		got := Merge([]domain.WorkspaceChatItem{api}, incoming, false)
		if len(got) != 1 || got[0].ID != "ui" || got[0].Payload[Owned] != true || got[0].Payload["attachments"] == nil {
			t.Fatalf("renderer duplicate snapshot did not converge: %#v", got)
		}
	}
}
