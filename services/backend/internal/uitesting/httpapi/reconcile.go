package httpapi

import (
	"errors"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/session"
	"kernl.local/harness/backend/internal/uitesting"
	"kernl.local/harness/backend/internal/uitesting/httpapi/runlifecycle"
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

// reconcileRunTasks delegates the run concern to the task-backed projection.
func (h *Routes) reconcileRunTasks(project string, doc uitesting.Document) (uitesting.Document, error) {
	return runlifecycle.Reconcile(project, doc, h.sessions, h.store, time.Now().UTC())
}
