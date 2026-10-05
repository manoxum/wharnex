package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/session"
	"kernl.local/harness/backend/internal/uitesting"
)

type runInput struct {
	TestIDs []string `json:"test_ids"`
}

func (h *Routes) run(w http.ResponseWriter, r *http.Request) {
	item, err := h.sessions.Get(r.PathValue("id"))
	if err != nil {
		writeErr(w, 404, err)
		return
	}
	var input runInput
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&input) != nil {
		writeErr(w, 400, errors.New("invalid UI test selection"))
		return
	}
	doc, err := h.store.Load(item.ProjectPath)
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	queued, err := h.enqueueSelection(r.Context(), item.ID, item.ProjectPath, doc, input.TestIDs, true)
	if err != nil {
		writeErr(w, 409, err)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"queued": queued})
}

// enqueueSelection queues one task per selected test that is not itself a
// prerequisite of another selected test: that prerequisite runs inside its
// dependent's chain, and the first dependent is told it may not skip it. With
// strict, any unconfigured test aborts the request; otherwise it is skipped.
func (h *Routes) enqueueSelection(ctx context.Context, sessionID, project string, doc uitesting.Document, ids []string, strict bool) ([]string, error) {
	selected := map[string]bool{}
	for _, id := range ids {
		if id = strings.TrimSpace(id); id != "" {
			selected[id] = true
		}
	}
	if len(selected) == 0 {
		for _, test := range doc.Tests {
			selected[test.ID] = true
		}
	}
	graph, err := uitesting.CatalogGraph(doc.Tests)
	if err != nil {
		return nil, err
	}
	mustRun := map[string]map[string]bool{}
	claimed := map[string]bool{}
	for _, test := range doc.Tests {
		if !selected[test.ID] {
			continue
		}
		order, err := graph.Order(test.ID)
		if err != nil {
			return nil, err
		}
		mustRun[test.ID] = map[string]bool{}
		for _, dep := range order {
			if selected[dep] && !claimed[dep] {
				mustRun[test.ID][dep], claimed[dep] = true, true
			}
		}
	}
	queued := []string{}
	for _, test := range doc.Tests {
		if !selected[test.ID] || claimed[test.ID] {
			continue
		}
		taskID, err := h.enqueueRun(ctx, sessionID, project, test, doc, mustRun[test.ID])
		if err != nil {
			if strict {
				return queued, err
			}
			continue
		}
		queued = append(queued, taskID)
	}
	return queued, nil
}

func (h *Routes) enqueueRun(ctx context.Context, sessionID, project string, test uitesting.TestCase, doc uitesting.Document, mustRun map[string]bool) (string, error) {
	taskID := session.NewChatAgentTaskID()
	runID := "run_" + strings.TrimPrefix(taskID, "cat_")
	payload, err := h.planRun(ctx, project, doc, test, runID, mustRun)
	if err != nil {
		return "", err
	}
	raw, _ := json.Marshal(payload)
	task, err := h.sessions.EnqueueChatAgentTask(session.ChatAgentTask{TaskID: taskID, Type: "UI_TEST_RUN", ProjectID: project, SessionID: sessionID, ChatID: taskID, RequestID: taskID, RootRequestID: taskID, DedupeKey: "ui-run:" + project + ":" + test.ID + ":" + doc.ContextSHA256, Payload: raw, MaxAttempts: 3, NotBefore: time.Now().UTC(), Title: "Teste UI · " + test.Title, Description: test.Goal})
	if err != nil {
		return "", err
	}
	if task.TaskID != taskID {
		return task.TaskID, nil // an identical run is already active
	}
	now := time.Now().UTC()
	runs := make([]uitesting.Run, 0, len(payload.Chain))
	for _, item := range payload.Chain {
		run := uitesting.Run{ID: item.RunID, TaskID: taskID, TestID: item.Test.ID, Role: item.Role, Status: "queued", StartedAt: now}
		if item.Role == uitesting.RunRoleDependency {
			run.ParentRunID = runID
		} else if payload.Restore != nil {
			run.RestoredFrom = payload.Restore.TestID
		}
		runs = append(runs, run)
	}
	_, err = h.store.BeginRun(project, runs...)
	return task.TaskID, err
}
