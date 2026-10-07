package session

import (
	"sort"
	"time"
)

// Lower values claim first. FIFO decides ties across all open projects.
var chatAgentPriorities = map[string]int{
	"TRANSLATE_MARKDOWN":   -3,
	"ORCHESTRATOR_PLAN":    -2,
	"ORCHESTRATOR_EXECUTE": -1,
	"RELEASE_NOTES":        -1,
	"UI_TEST_DISCOVER":     -1,
	"UI_TEST_RUN":          0,
	"BOT_WRITE":            0, "RECOVERY_WRITE": 0,
	"AWAIT_RESPONSE": 1,
	"TITLE_DISCOVER": 2, "TITLE_GENERATE_TEMP": 2, "TITLE_AWAIT": 2,
	"ORGANIZE_CHAT": 2, "RENAME_CHAT": 2,
	"ARCHIVE_CHAT": 3, "DELETE_CHAT": 3,
	"DELETE_BUNDLE": 4, "DELETE_TEMP_CHAT": 4,
	"TODO_CLASSIFY": 5,
}

func chatAgentEffectivePriority(task ChatAgentTask, now time.Time) int {
	priority := task.Priority
	// Existing durable rows keep their original numeric priority. Apply the
	// new bands at claim time so pending work benefits without a data rewrite.
	if task.Type == "TRANSLATE_MARKDOWN" || task.Type == "ORCHESTRATOR_PLAN" {
		if current := chatAgentPriorities[task.Type]; priority > current {
			priority = current
		}
	}
	if priority <= 1 {
		return priority
	}
	aged := int(now.Sub(task.CreatedAt) / (15 * time.Minute))
	value := priority - aged
	if value < 1 {
		return 1
	}
	return value
}

func chatAgentEffectivePrioritySQL(alias string) string {
	return `CASE
		WHEN ` + alias + `.type='TRANSLATE_MARKDOWN' THEN LEAST(` + alias + `.priority,-3)
		WHEN ` + alias + `.type='ORCHESTRATOR_PLAN' THEN LEAST(` + alias + `.priority,-2)
		WHEN ` + alias + `.priority<=1 THEN ` + alias + `.priority
		ELSE GREATEST(1, ` + alias + `.priority-LEAST(` + alias + `.priority-1, FLOOR(EXTRACT(EPOCH FROM (now()-` + alias + `.created_at))/900)::int))
	END`
}

// ChatAgentTaskKind describes one browser task type for policy surfaces.
type ChatAgentTaskKind struct {
	Type string `json:"type"`
	// Pool is the partition that claims it: supervisor, worker or ephemeral.
	Pool string `json:"pool"`
	// Uploads reports whether the task attaches a request archive, and is
	// therefore subject to the account file-upload limit.
	Uploads bool `json:"uploads"`
}

var chatAgentUploadTypes = []string{
	"BOT_WRITE", "RECOVERY_WRITE", "ORCHESTRATOR_PLAN", "ORCHESTRATOR_EXECUTE",
	"TRANSLATE_MARKDOWN", "RELEASE_NOTES", "TODO_CLASSIFY", "UI_TEST_DISCOVER", "UI_TEST_RUN",
}

// ChatAgentTaskCatalog lists every browser task type the queue accepts, so a
// policy surface can never miss one: it is derived from the same table the
// queue validates against.
func ChatAgentTaskCatalog() []ChatAgentTaskKind {
	kinds := make([]ChatAgentTaskKind, 0, len(chatAgentPriorities))
	for taskType := range chatAgentPriorities {
		pool := "worker"
		switch {
		case chatAgentTaskSupervisor(taskType):
			pool = "supervisor"
		case chatAgentTaskEphemeral(taskType):
			pool = "ephemeral"
		}
		kinds = append(kinds, ChatAgentTaskKind{Type: taskType, Pool: pool, Uploads: chatAgentTaskTypeIn(taskType, chatAgentUploadTypes)})
	}
	sort.Slice(kinds, func(i, j int) bool { return kinds[i].Type < kinds[j].Type })
	return kinds
}
