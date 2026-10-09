package bundleusage

import (
	"testing"
	"time"

	"kernl.local/harness/backend/internal/oplog"
)

func TestConfirmedUploadsCoverTaskTypesAndExcludePreparedAndFailedTransfers(t *testing.T) {
	now := time.Date(2026, 10, 6, 15, 0, 0, 0, time.UTC)
	tasks := []Task{{ID: "cat_11111111111111111111", Type: "UI_TEST_RUN"}, {ID: "cat_22222222222222222222", Type: "TRANSLATE_MARKDOWN"}}
	upload := func(id, task, message string, at time.Time) oplog.Record {
		return oplog.Record{ID: id, Source: "desktop", Component: "chatgpt-upload", Message: message, TraceID: "task:" + task + ":1", OccurredAt: at, Data: map[string]any{"observed": "true"}}
	}
	records := []oplog.Record{
		upload("step", tasks[0].ID, "confirmed wc=1 file=1/1 observed=true", now.Add(-time.Hour)),
		upload("guide", tasks[0].ID, "confirmed wc=1 file=1/1 observed=true", now.Add(-time.Minute)),
		upload("part1", tasks[1].ID, "confirmed wc=2 file=1/2 observed=true", now.Add(-3*time.Hour)),
		upload("part2", tasks[1].ID, "confirmed wc=2 file=2/2 observed=true", now),
		upload("retry", tasks[0].ID, "retry failedAttempt=1", now),
		upload("old", tasks[0].ID, "confirmed wc=1 file=1/1", now.Add(-3*time.Hour-time.Second)),
		upload("future", tasks[0].ID, "confirmed wc=1 file=1/1", now.Add(time.Second)),
		{ID: "prepared", Source: "backend", Component: "artifact", Event: "artifact.persisted", OccurredAt: now},
	}
	records = append(records, records[0]) // Replayed durable identity counts once.
	got := Summarize(records, tasks, now.Add(-3*time.Hour), now)
	if len(got) != 2 || got[0].Sent != 2 || got[1].Sent != 2 || got[0].Received != 0 {
		t.Fatalf("confirmed uploads across task types = %#v; want two UI uploads and two translation parts", got)
	}
}

func TestCompletedDownloadSupersedesDeliveryWithoutSuppressingRealRepeatedExchanges(t *testing.T) {
	now := time.Now().UTC()
	taskID := "cat_11111111111111111111"
	filename := "whx_ui_test_step_res_" + taskID + "_1.zip"
	records := []oplog.Record{
		{ID: "receive", Source: "desktop", Component: "chatgpt-bundle-received", TaskID: taskID, OccurredAt: now.Add(-time.Minute), Data: map[string]any{"file": filename}},
		{ID: "delivery", Source: "backend", Component: "http", OccurredAt: now.Add(-59 * time.Second), Data: map[string]any{"route": "POST /api/ui-testing/tasks/{id}/step/result", "path": "/api/ui-testing/tasks/" + taskID + "/step/result", "status": 400}},
		{ID: "repeat", Source: "desktop", Component: "chatgpt-bundle-received", TaskID: taskID, OccurredAt: now, Data: map[string]any{"file": filename}},
		{ID: "legacy", Source: "backend", Component: "http", OccurredAt: now.Add(-time.Hour), Data: map[string]any{"route": "POST /api/ui-testing/tasks/{id}/guide/result", "path": "/api/ui-testing/tasks/" + taskID + "/guide/result", "status": 200}},
		{ID: "failure", Source: "backend", Component: "http", OccurredAt: now, Data: map[string]any{"route": "POST /api/ui-testing/tasks/{id}/step/result", "status": 500}},
	}
	got := Summarize(records, []Task{{ID: taskID, Type: "UI_TEST_RUN"}}, now.Add(-3*time.Hour), now)
	if len(got) != 1 || got[0].Received != 3 || got[0].EstimatedReceived != 1 || got[0].Total != 3 {
		t.Fatalf("completed and historical response counts = %#v; want 3 received, 1 inferred", got)
	}
}

func TestUnknownAndUnqueuedAgentRequestsRemainVisible(t *testing.T) {
	now := time.Now().UTC()
	records := []oplog.Record{
		{ID: "agent", Source: "desktop", Component: "chatgpt-upload", Message: "confirmed wc=1 file=1/1", TraceID: "prepare:req_20261006T150000_1111111111111111:abc", OccurredAt: now, Data: map[string]any{"observed": "true"}},
		{ID: "new", Source: "desktop", Component: "chatgpt-upload", Message: "confirmed wc=2 file=1/1", TaskID: "cat_22222222222222222222", OccurredAt: now, Data: map[string]any{"observed": "true"}},
	}
	got := Summarize(records, []Task{{ID: "cat_22222222222222222222", Type: "FUTURE_TASK"}}, now.Add(-time.Hour), now)
	if len(got) != 2 || got[0].Type != "AGENT_REQUEST" || got[1].Type != "FUTURE_TASK" {
		t.Fatalf("unqueued and new task types disappeared: %#v", got)
	}
}

func TestDeliveryInsideWindowDoesNotRecountADownloadOutsideIt(t *testing.T) {
	start := time.Date(2026, 10, 6, 12, 0, 0, 0, time.UTC)
	taskID := "cat_11111111111111111111"
	records := []oplog.Record{
		{ID: "outside", Source: "desktop", Component: "chatgpt-bundle-received", TaskID: taskID, OccurredAt: start.Add(-time.Second), Data: map[string]any{"file": "whx_ui_test_step_res_" + taskID + "_1.zip"}},
		{ID: "inside", Source: "backend", Component: "http", OccurredAt: start.Add(time.Second), Data: map[string]any{"route": "POST /api/ui-testing/tasks/{id}/step/result", "path": "/api/ui-testing/tasks/" + taskID + "/step/result", "status": 200}},
	}
	if got := Summarize(records, nil, start, start.Add(3*time.Hour)); len(got) != 0 {
		t.Fatalf("local delivery counted a transfer outside the window: %#v", got)
	}
}

func TestRequestCatalogAttributesUnqueuedUploadsToTheirSendingTask(t *testing.T) {
	now := time.Now().UTC()
	requestID := "req_20261006T150000_1111111111111111"
	record := oplog.Record{ID: "upload", Source: "desktop", Component: "chatgpt-upload", Message: "confirmed wc=1 file=1/1", TraceID: "prepare:" + requestID + ":abc", OccurredAt: now, Data: map[string]any{"observed": true}}
	for _, task := range []Task{{ID: "writer", Type: "BOT_WRITE", RequestID: requestID}, {ID: "round", Type: "ORCHESTRATOR_TASK", Source: "orchestrator", RequestID: requestID}} {
		got := Summarize([]oplog.Record{record}, []Task{task, {ID: "observer", Type: "AWAIT_RESPONSE", RequestID: requestID}}, now.Add(-time.Hour), now)
		want := task.Type
		if task.Source == "orchestrator" {
			want = "ORCHESTRATOR_EXECUTE"
		}
		if len(got) != 1 || got[0].Type != want || got[0].Sent != 1 {
			t.Fatalf("sending-task attribution = %#v; want %s", got, want)
		}
	}
}

func TestOrchestratorTaskBundleResolvesItsDurableTaskIdentity(t *testing.T) {
	now := time.Now().UTC()
	requestID := "req_20261006T150000_1111111111111111"
	records := []oplog.Record{
		{ID: "send", Source: "desktop", Component: "chatgpt-upload", Message: "confirmed wc=1 file=1/1", OccurredAt: now, Data: map[string]any{"observed": true, "name": "whx_bundle_req_task-alpha_" + requestID + ".zip"}},
		{ID: "receive", Source: "desktop", Component: "chatgpt-bundle-received", OccurredAt: now, Data: map[string]any{"file": "whx_bundle_res_task-alpha_" + requestID + ".zip"}},
	}
	got := Summarize(records, []Task{{ID: "task-alpha", Type: "ORCHESTRATOR_TASK", Source: "orchestrator"}}, now.Add(-time.Hour), now)
	if len(got) != 1 || got[0].Type != "ORCHESTRATOR_EXECUTE" || got[0].Sent != 1 || got[0].Received != 1 {
		t.Fatalf("task-scoped Orchestrator exchange attributed incorrectly: %#v", got)
	}
}
