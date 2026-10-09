// Package taskactivity derives UI Lab activity from durable browser-task leases.
package taskactivity

import (
	"time"

	"kernl.local/harness/backend/internal/session"
)

func State(task session.ChatAgentTask, now time.Time) string {
	if task.Status == session.ChatAgentTaskRunning && task.LeaseOwner != "" && task.LeaseExpiresAt != nil && task.LeaseExpiresAt.After(now) {
		return "running"
	}
	if task.Status == session.ChatAgentTaskWaiting || task.NotBefore.After(now) {
		return "waiting"
	}
	return "queued"
}
