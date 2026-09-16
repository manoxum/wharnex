package app

import (
	"encoding/json"
	"time"

	"kernl.local/harness/backend/internal/domain"
)

// projectExecutionSummary is deliberately aggregate-only. The debug protocol
// can answer operational-rate questions without exposing command output,
// credentials, arbitrary event bodies, or a generic database query surface.
type projectExecutionSummary struct {
	Protocol            string         `json:"protocol"`
	ProjectPath         string         `json:"project_path"`
	SessionsTotal       int            `json:"sessions_total"`
	ExecutionsTotal     int            `json:"executions_total"`
	ExecutionsSucceeded int            `json:"executions_succeeded"`
	ExecutionsFailed    int            `json:"executions_failed"`
	HostApplied         int            `json:"host_applied"`
	RestartPending      int            `json:"restart_pending"`
	FailureKinds        map[string]int `json:"failure_kinds"`
}

func (s *Service) projectExecutionSummary(projectPath string) projectExecutionSummary {
	summary := projectExecutionSummary{
		Protocol: "harness.debug-result/v1", ProjectPath: projectPath,
		FailureKinds: map[string]int{},
	}
	for _, item := range s.store.List() {
		if item.ProjectPath != projectPath {
			continue
		}
		summary.SessionsTotal++
		if item.State == "restart_pending" || item.SelfEvolutionActivation == "restart_pending" {
			summary.RestartPending++
		}
		if item.FailureKind != "" {
			summary.FailureKinds[string(item.FailureKind)]++
		}
		for _, event := range s.bus.History(item.ID) {
			switch event.Type {
			case EventExecutionRecorded:
				summary.ExecutionsTotal++
				if success, _ := event.Data["success"].(bool); success {
					summary.ExecutionsSucceeded++
				} else {
					summary.ExecutionsFailed++
				}
			case "host.applied":
				summary.HostApplied++
			}
		}
	}
	return summary
}

func (s *Service) executeDebugQuery(sessionID string, item domain.Session, query string) (domain.CommandResult, error) {
	started := time.Now().UTC()
	summary := s.projectExecutionSummary(item.ProjectPath)
	output, err := json.Marshal(summary)
	result := domain.CommandResult{
		Argv: []string{"wharnex:debug", query}, Cwd: ".", ExitCode: 0,
		Stdout: string(output), Success: err == nil, DurationMS: time.Since(started).Milliseconds(),
	}
	if err != nil {
		result.ExitCode = -1
		result.Stderr = err.Error()
	}
	s.bus.Publish(sessionID, "debug.query_completed", map[string]any{
		"query": query, "success": result.Success, "duration_ms": result.DurationMS,
		"executions_total": summary.ExecutionsTotal,
	})
	return result, err
}
