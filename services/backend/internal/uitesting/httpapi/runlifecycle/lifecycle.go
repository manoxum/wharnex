// Package runlifecycle projects UI runs from their durable browser tasks.
package runlifecycle

import (
	"errors"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/session"
	"kernl.local/harness/backend/internal/uitesting"
	"kernl.local/harness/backend/internal/uitesting/httpapi/taskactivity"
)

type Tasks interface {
	GetChatAgentTask(string) (session.ChatAgentTask, error)
}
type Runs interface {
	CompleteRun(string, uitesting.Run, uitesting.RunResult) (uitesting.Document, error)
}

// Reconcile closes abandoned runs and overlays current queue activity without
// rewriting historical results or charging a task attempt. The stored catalog
// may predate this projection (BeginRun used to call every queued test running).
func Reconcile(project string, doc uitesting.Document, tasks Tasks, runs Runs, now time.Time) (uitesting.Document, error) {
	states := map[string]string{}
	taskCache := map[string]session.ChatAgentTask{}
	missing := map[string]bool{}
	for _, run := range doc.Runs {
		if run.Status != "queued" && run.Status != "running" && run.Status != "waiting" {
			continue
		}
		task, known := taskCache[run.TaskID]
		var err error
		if !known && !missing[run.TaskID] {
			task, err = tasks.GetChatAgentTask(run.TaskID)
			if errors.Is(err, session.ErrChatAgentTaskNotFound) {
				missing[run.TaskID] = true
			} else if err == nil {
				taskCache[run.TaskID] = task
			}
		}
		if missing[run.TaskID] {
			err = session.ErrChatAgentTaskNotFound
		}
		detail := ""
		if errors.Is(err, session.ErrChatAgentTaskNotFound) {
			detail = "A tarefa já não está disponível. Tente novamente."
		} else if err != nil {
			return doc, err
		}
		if detail == "" {
			detail = terminalDetail(task)
		}
		if detail != "" {
			if _, err := runs.CompleteRun(project, uitesting.Run{ID: run.ID}, uitesting.RunResult{Status: "failed", Error: detail}); err != nil {
				return doc, err
			}
			// Keep this response's newer catalog identity: completing an older run in
			// the store must not hide a newer queued or successfully finished run.
			states[run.ID] = "failed"
			for i := range doc.Runs {
				if doc.Runs[i].ID == run.ID {
					doc.Runs[i].Status, doc.Runs[i].Error, doc.Runs[i].CompletedAt = "failed", detail, now
				}
			}
			continue
		}
		states[run.ID] = taskactivity.State(task, now)
	}
	for i := range doc.Runs {
		if state, ok := states[doc.Runs[i].ID]; ok {
			doc.Runs[i].Status = state
		}
	}
	return projectCatalog(doc), nil
}

// projectCatalog also repairs legacy snapshots that pointed to an older run.
func projectCatalog(doc uitesting.Document) uitesting.Document {
	byID := map[string]uitesting.Run{}
	latest := map[string]uitesting.Run{}
	for _, run := range doc.Runs {
		byID[run.ID] = run
		if current, ok := latest[run.TestID]; !ok || run.StartedAt.After(current.StartedAt) {
			latest[run.TestID] = run
		}
	}
	for i := range doc.Tests {
		test := &doc.Tests[i]
		run, ok := latest[test.ID]
		if !ok {
			run, ok = byID[test.LastRunID]
		}
		if ok {
			test.LastRunID = run.ID
			test.Status = catalogStatus(run.Status)
		} else if test.Status == "running" || test.Status == "queued" || test.Status == "waiting" {
			// History is bounded; an obsolete catalog flag is not evidence of activity.
			test.Status = "ready"
		}
	}
	return doc
}

func terminalDetail(task session.ChatAgentTask) string {
	switch task.Status {
	case session.ChatAgentTaskCancelled:
		return "A execução foi cancelada."
	case session.ChatAgentTaskFailed, session.ChatAgentTaskAttention:
		if detail := strings.TrimSpace(task.LastError); detail != "" {
			return detail
		}
		return "A execução terminou sem concluir este teste."
	case session.ChatAgentTaskDone:
		return "A execução terminou sem registar o resultado deste teste."
	}
	return ""
}

func catalogStatus(status string) string {
	if status == "skipped" {
		return "blocked"
	}
	return status
}
