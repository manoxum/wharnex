package httpapi

import (
	"errors"
	"strings"

	"kernl.local/harness/backend/internal/session"
	"kernl.local/harness/backend/internal/uitesting"
)

func (h *Routes) reconcileSyncTask(project string, doc uitesting.Document) (uitesting.Document, error) {
	if doc.SyncStatus != "syncing" || strings.TrimSpace(doc.SyncTaskID) == "" {
		return doc, nil
	}
	detail, terminal, err := h.terminalTaskDetail(doc.SyncTaskID, "A sincronização do UI Lab terminou sem concluir a descoberta.", "A tarefa de sincronização terminou sem guardar o catálogo de testes. Tente sincronizar novamente.")
	if err != nil || !terminal {
		return doc, err
	}
	return h.store.FailSync(project, doc.SyncTaskID, detail)
}

func (h *Routes) reconcileDesignTasks(project string, doc uitesting.Document) (uitesting.Document, error) {
	for _, design := range doc.Designs {
		if design.Status != "designing" {
			continue
		}
		detail, terminal, err := h.terminalTaskDetail(design.TaskID, "O desenho do teste terminou sem resultado.", "A tarefa terminou sem guardar o teste desenhado. Tente novamente.")
		if err != nil {
			return doc, err
		}
		if terminal {
			if doc, err = h.store.FailDesign(project, design.TaskID, detail); err != nil {
				return doc, err
			}
		}
	}
	return doc, nil
}

// terminalTaskDetail reports whether a discovery task ended without its result
// reaching the store, and the operator-facing reason.
func (h *Routes) terminalTaskDetail(taskID, failed, doneWithout string) (string, bool, error) {
	task, err := h.sessions.GetChatAgentTask(taskID)
	if errors.Is(err, session.ErrChatAgentTaskNotFound) {
		return "A tarefa já não está disponível. Tente novamente.", true, nil
	}
	if err != nil {
		return "", false, err
	}
	switch task.Status {
	case session.ChatAgentTaskCancelled:
		// The last error of a cancelled task is whatever it observed before
		// the cancellation, not why it ended.
		return "A execução foi cancelada.", true, nil
	case session.ChatAgentTaskFailed, session.ChatAgentTaskAttention:
		if detail := strings.TrimSpace(task.LastError); detail != "" {
			return detail, true, nil
		}
		return failed, true, nil
	case session.ChatAgentTaskDone:
		return doneWithout, true, nil
	}
	return "", false, nil
}

// reconcileRunTasks closes runs whose task ended without reporting them — a
// Desktop restart that exhausted the task's attempts, a cancellation — so no
// run stays queued or running forever.
func (h *Routes) reconcileRunTasks(project string, doc uitesting.Document) (uitesting.Document, error) {
	details := map[string]string{}
	for _, run := range doc.Runs {
		if run.Status != "queued" && run.Status != "running" {
			continue
		}
		detail, known := details[run.TaskID]
		if !known {
			var terminal bool
			var err error
			detail, terminal, err = h.terminalTaskDetail(run.TaskID, "A execução terminou sem concluir este teste.", "A execução terminou sem registar o resultado deste teste.")
			if err != nil {
				return doc, err
			}
			if !terminal {
				detail = ""
			}
			details[run.TaskID] = detail
		}
		if detail == "" {
			continue
		}
		next, err := h.store.CompleteRun(project, uitesting.Run{ID: run.ID}, uitesting.RunResult{Status: "failed", Error: detail})
		if err != nil {
			return doc, err
		}
		doc = next
	}
	return doc, nil
}
