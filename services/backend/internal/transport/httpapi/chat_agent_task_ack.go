package httpapi

import (
	"net/http"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/session"
)

// chatAgentTaskAck is the lease-state view of a task returned to a caller
// that asked for `Prefer: return=minimal` (RFC 7240). The Desktop scheduler
// transitions a task — start, heartbeat, wait, complete — several times per
// round and never reads the task back, yet each answer used to carry the
// whole payload, request bundle included: hundreds of kilobytes per
// heartbeat. Callers that omit the preference still receive the full task.
type chatAgentTaskAck struct {
	TaskID         string     `json:"task_id"`
	Status         string     `json:"status"`
	Attempt        int        `json:"attempt"`
	MaxAttempts    int        `json:"max_attempts"`
	NotBefore      time.Time  `json:"not_before"`
	LeaseExpiresAt *time.Time `json:"lease_expires_at,omitempty"`
	UpdatedAt      time.Time  `json:"updated_at"`
}

func writeChatAgentTask(w http.ResponseWriter, r *http.Request, task session.ChatAgentTask) {
	if !prefersMinimalReturn(r) {
		writeJSON(w, http.StatusOK, task)
		return
	}
	w.Header().Set("Preference-Applied", "return=minimal")
	writeJSON(w, http.StatusOK, chatAgentTaskAck{
		TaskID: task.TaskID, Status: task.Status, Attempt: task.Attempt, MaxAttempts: task.MaxAttempts,
		NotBefore: task.NotBefore, LeaseExpiresAt: task.LeaseExpiresAt, UpdatedAt: task.UpdatedAt,
	})
}

func prefersMinimalReturn(r *http.Request) bool {
	for _, header := range r.Header.Values("Prefer") {
		for _, preference := range strings.Split(header, ",") {
			if strings.EqualFold(strings.TrimSpace(preference), "return=minimal") {
				return true
			}
		}
	}
	return false
}
