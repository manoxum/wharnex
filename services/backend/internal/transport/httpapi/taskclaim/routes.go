// Package taskclaim owns the durable browser-agent claim transport.
//
// The claim is where every pool partition, project scope and automation hold is
// enforced: a claim charges an attempt, so work that must not run is excluded
// here, before anything is charged, never claimed and handed back.
package taskclaim

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/automationhold"
	"kernl.local/harness/backend/internal/session"
)

// Claimer is the durable queue the route claims from.
type Claimer interface {
	ClaimChatAgentTaskWithOptions(owner string, lease time.Duration, options session.ChatAgentClaimOptions) (*session.ChatAgentTask, error)
}

type request struct {
	Owner         string   `json:"owner"`
	LeaseSeconds  int      `json:"lease_seconds"`
	WorkerID      string   `json:"worker_id"`
	PreferredLane string   `json:"preferred_lane"`
	ExcludedLanes []string `json:"excluded_lanes"`
	ExcludedTypes []string `json:"excluded_types"`
	FallbackMode  string   `json:"fallback_mode"`
	// Role partitions task types between the chat-bound Supervisor pool and the
	// small-task Worker pool. Empty stays unrestricted for callers that run no
	// role-partitioned pool.
	Role string `json:"role"`
	// ProjectScoped is what separates "no project is open" from "this caller
	// cannot scope by project"; an empty OpenProjects cannot express both.
	ProjectScoped bool     `json:"project_scoped"`
	OpenProjects  []string `json:"open_projects"`
}

// Register mounts POST /api/chat-agent/tasks/claim.
func Register(mux *http.ServeMux, claimer Claimer, holds automationhold.Store, catalog automationhold.Catalog) {
	mux.HandleFunc("POST /api/chat-agent/tasks/claim", func(w http.ResponseWriter, r *http.Request) {
		var body request
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 2<<20))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&body); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_json", err.Error())
			return
		}
		lease := time.Duration(body.LeaseSeconds) * time.Second
		if lease == 0 {
			lease = 45 * time.Second
		}
		excluded, err := heldTypes(r.Context(), holds, catalog, body.ExcludedTypes)
		if err != nil {
			// An unreadable hold fails closed: claiming held work is the one
			// outcome the hold exists to prevent.
			writeError(w, http.StatusServiceUnavailable, "automation_hold_unavailable", err.Error())
			return
		}
		task, err := claimer.ClaimChatAgentTaskWithOptions(body.Owner, lease, session.ChatAgentClaimOptions{
			WorkerID: body.WorkerID, PreferredLane: body.PreferredLane, ExcludedLanes: body.ExcludedLanes, ExcludedTypes: excluded, FallbackMode: body.FallbackMode,
			Role: body.Role, ProjectScoped: body.ProjectScoped, OpenProjects: body.OpenProjects,
		})
		if err != nil {
			writeClaimError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"task": task})
	})
}

func heldTypes(ctx context.Context, holds automationhold.Store, catalog automationhold.Catalog, requested []string) ([]string, error) {
	if holds == nil {
		return requested, nil
	}
	held, err := automationhold.ExcludedTaskTypes(ctx, holds, catalog, time.Now().UTC())
	if err != nil {
		return nil, err
	}
	return append(append([]string{}, requested...), held...), nil
}

func writeClaimError(w http.ResponseWriter, err error) {
	message := err.Error()
	if strings.Contains(message, "required") || strings.Contains(message, "unsupported") || strings.Contains(message, "must be") {
		writeError(w, http.StatusBadRequest, "invalid_chat_agent_task", message)
		return
	}
	writeError(w, http.StatusInternalServerError, "chat_agent_task_failed", message)
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]any{"error": map[string]string{"code": code, "message": message}})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
