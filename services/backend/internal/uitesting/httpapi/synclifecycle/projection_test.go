package synclifecycle_test

import (
	"testing"
	"time"

	"kernl.local/harness/backend/internal/session"
	"kernl.local/harness/backend/internal/uitesting"
	"kernl.local/harness/backend/internal/uitesting/httpapi/synclifecycle"
)

type taskLookup struct{ task session.ChatAgentTask }

func (s taskLookup) GetChatAgentTask(string) (session.ChatAgentTask, error) {
	return s.task, nil
}

func TestDiscoveryRequiresALiveOwnedLease(t *testing.T) {
	now := time.Date(2026, 10, 7, 12, 0, 0, 0, time.UTC)
	live, expired := now.Add(time.Minute), now.Add(-time.Second)
	doc := uitesting.Document{ProjectID: "/project", SyncStatus: "syncing", SyncTaskID: "cat_sync"}
	for _, tc := range []struct {
		name, owner, state string
		lease              *time.Time
	}{
		{"live", "desktop:worker-5", "running", &live},
		{"expired", "desktop:worker-5", "queued", &expired},
		{"no deadline", "desktop:worker-5", "queued", nil},
		{"no owner", "", "queued", &live},
	} {
		t.Run(tc.name, func(t *testing.T) {
			task := session.ChatAgentTask{Type: "UI_TEST_DISCOVER", ProjectID: doc.ProjectID,
				Status: session.ChatAgentTaskRunning, LeaseOwner: tc.owner, LeaseExpiresAt: tc.lease}
			view, err := synclifecycle.Project(doc, taskLookup{task}, now)
			if err != nil || view.SyncActivity == nil || view.SyncActivity.State != tc.state {
				t.Fatalf("view=%+v err=%v", view, err)
			}
			if tc.state != "running" && view.SyncActivity.Worker != 0 {
				t.Fatalf("inactive lease still names a Worker: %+v", view.SyncActivity)
			}
		})
	}
}

func TestDiscoveryActivityNeverFollowsAnotherProjectOrTaskType(t *testing.T) {
	doc := uitesting.Document{ProjectID: "/project", SyncStatus: "syncing", SyncTaskID: "cat_sync"}
	for _, task := range []session.ChatAgentTask{
		{ProjectID: "/other-project", Type: "UI_TEST_DISCOVER"},
		{ProjectID: doc.ProjectID, Type: "UI_TEST_RUN"},
	} {
		view, err := synclifecycle.Project(doc, taskLookup{task}, time.Now())
		if err != nil || view.SyncActivity != nil {
			t.Fatalf("unrelated task projected into discovery: %+v err=%v", view, err)
		}
	}
}
