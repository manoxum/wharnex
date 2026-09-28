package session

import "time"

// Lower values claim first. FIFO decides ties across all open projects.
var chatAgentPriorities = map[string]int{
	"TRANSLATE_MARKDOWN":   -3,
	"ORCHESTRATOR_PLAN":    -2,
	"ORCHESTRATOR_EXECUTE": -1,
	"RELEASE_NOTES":        -1,
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
