// Package synclifecycle projects discovery activity without persisting UI state.
package synclifecycle

import (
	"errors"
	"strconv"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/session"
	"kernl.local/harness/backend/internal/uitesting"
	"kernl.local/harness/backend/internal/uitesting/httpapi/taskactivity"
)

type Tasks interface {
	GetChatAgentTask(string) (session.ChatAgentTask, error)
}

type Activity struct {
	State     string     `json:"state"`
	Worker    int        `json:"worker,omitempty"`
	Reason    string     `json:"reason,omitempty"`
	NotBefore *time.Time `json:"not_before,omitempty"`
}

type View struct {
	uitesting.Document
	SyncActivity *Activity `json:"sync_activity,omitempty"`
}

func Project(doc uitesting.Document, tasks Tasks, now time.Time) (View, error) {
	view := View{Document: doc}
	if doc.SyncStatus != "syncing" || doc.SyncTaskID == "" {
		return view, nil
	}
	task, err := tasks.GetChatAgentTask(doc.SyncTaskID)
	if errors.Is(err, session.ErrChatAgentTaskNotFound) {
		return view, nil
	}
	if err != nil {
		return view, err
	}
	if task.Type != "UI_TEST_DISCOVER" || task.ProjectID != doc.ProjectID {
		return view, nil
	}
	activity := &Activity{State: taskactivity.State(task, now)}
	if activity.State == "running" {
		owner := task.LeaseOwner[strings.LastIndex(task.LeaseOwner, ":")+1:]
		if strings.HasPrefix(owner, "worker-") {
			worker, _ := strconv.Atoi(strings.TrimPrefix(owner, "worker-"))
			if worker > 0 {
				activity.Worker = worker
			}
		}
	} else if activity.State == "waiting" {
		activity.Reason = task.LastError
		if task.NotBefore.After(now) {
			activity.NotBefore = &task.NotBefore
		}
	}
	view.SyncActivity = activity
	return view, nil
}
