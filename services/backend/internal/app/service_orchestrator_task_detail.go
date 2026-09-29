package app

import (
	"context"
	"errors"
	"sort"
	"time"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/orchestrator"
)

const OrchestratorTaskDetailProtocol = "harness.orchestrator-task-detail/v1"

type OrchestratorTaskChat struct {
	ConversationURL string                         `json:"conversation_url,omitempty"`
	ConversationID  string                         `json:"conversation_id,omitempty"`
	Sessions        []OrchestratorTaskAgentSession `json:"sessions"`
}

type OrchestratorTaskAgentSession struct {
	RunID      string            `json:"run_id"`
	SessionID  string            `json:"session_id"`
	RequestIDs []string          `json:"request_ids"`
	State      string            `json:"state"`
	LastTurn   *domain.AgentTurn `json:"last_turn,omitempty"`
	Events     []domain.Event    `json:"events"`
}

type OrchestratorTaskFile struct {
	RunID     string                `json:"run_id"`
	SessionID string                `json:"session_id"`
	Artifact  domain.ArtifactRecord `json:"artifact"`
}

type OrchestratorTaskPlan struct {
	RunID      string         `json:"run_id"`
	SessionID  string         `json:"session_id"`
	RequestID  string         `json:"request_id"`
	PlanID     string         `json:"plan_id"`
	RecordedAt *time.Time     `json:"recorded_at,omitempty"`
	Current    bool           `json:"current,omitempty"`
	Plan       map[string]any `json:"plan"`
}

type OrchestratorTaskExecution struct {
	RunID      string         `json:"run_id"`
	SessionID  string         `json:"session_id"`
	RequestID  string         `json:"request_id"`
	PlanID     string         `json:"plan_id"`
	RecordedAt *time.Time     `json:"recorded_at,omitempty"`
	Current    bool           `json:"current,omitempty"`
	Success    bool           `json:"success"`
	Execution  map[string]any `json:"execution"`
}

type OrchestratorTaskActiveWorker struct {
	WorkerTaskID   string     `json:"worker_task_id"`
	Status         string     `json:"status"`
	LeaseOwner     string     `json:"lease_owner"`
	AssignedWorker string     `json:"assigned_worker,omitempty"`
	SessionID      string     `json:"session_id,omitempty"`
	RequestID      string     `json:"request_id,omitempty"`
	ConversationID string     `json:"conversation_id,omitempty"`
	LeaseExpiresAt *time.Time `json:"lease_expires_at"`
}

type OrchestratorTaskEngine struct {
	ActiveWorker *OrchestratorTaskActiveWorker `json:"active_worker"`
}

type OrchestratorTaskDetail struct {
	Protocol  string                      `json:"protocol"`
	Task      orchestrator.Task           `json:"task"`
	Runs      []orchestrator.TaskRun      `json:"runs"`
	Chat      OrchestratorTaskChat        `json:"chat"`
	Files     []OrchestratorTaskFile      `json:"files"`
	Plans     []OrchestratorTaskPlan      `json:"plans"`
	Execution []OrchestratorTaskExecution `json:"execution"`
	Engine    OrchestratorTaskEngine      `json:"engine"`
}

func (s *Service) OrchestratorTaskDetail(ctx context.Context, sessionID, taskID string) (OrchestratorTaskDetail, error) {
	owner, err := s.store.Get(sessionID)
	if err != nil {
		return OrchestratorTaskDetail{}, err
	}
	task, err := s.orchestrator.GetTask(ctx, taskID)
	if err != nil {
		return OrchestratorTaskDetail{}, err
	}
	if task.ProjectPath != owner.ProjectPath {
		return OrchestratorTaskDetail{}, errors.New("task does not belong to this project")
	}
	runs, err := s.orchestrator.ListRuns(ctx, taskID)
	if err != nil {
		return OrchestratorTaskDetail{}, err
	}
	detail := OrchestratorTaskDetail{Protocol: OrchestratorTaskDetailProtocol, Task: task, Runs: runs,
		Chat:  OrchestratorTaskChat{ConversationURL: task.ConversationURL, ConversationID: task.ConversationID, Sessions: []OrchestratorTaskAgentSession{}},
		Files: []OrchestratorTaskFile{}, Plans: []OrchestratorTaskPlan{}, Execution: []OrchestratorTaskExecution{}}
	for _, run := range runs {
		if run.ProjectPath != task.ProjectPath {
			return OrchestratorTaskDetail{}, errors.New("task run does not belong to this project")
		}
		if run.SessionID == "" {
			continue
		}
		agent, getErr := s.store.Get(run.SessionID)
		if getErr != nil {
			return OrchestratorTaskDetail{}, getErr
		}
		if agent.ProjectPath != task.ProjectPath {
			return OrchestratorTaskDetail{}, errors.New("task run session does not belong to this project")
		}
		allowed, ordered := orchestratorRunRequestIDs(run, agent)
		events := filterOrchestratorTaskEvents(s.bus.History(agent.ID), allowed)
		detail.Chat.Sessions = append(detail.Chat.Sessions, OrchestratorTaskAgentSession{
			RunID: run.ID, SessionID: agent.ID, RequestIDs: ordered, State: agent.State, LastTurn: taskLastTurn(agent.LastTurn, allowed), Events: events,
		})
		for _, artifact := range agent.Artifacts {
			if requestBelongsToRun(artifact.RequestID, allowed) {
				detail.Files = append(detail.Files, OrchestratorTaskFile{RunID: run.ID, SessionID: agent.ID, Artifact: artifact})
			}
		}
		plans, executions := orchestratorTaskActivity(run.ID, agent, events, allowed)
		detail.Plans = append(detail.Plans, plans...)
		detail.Execution = append(detail.Execution, executions...)
	}
	detail.Engine.ActiveWorker, err = s.activeOrchestratorTaskWorker(task)
	return detail, err
}

func orchestratorRunRequestIDs(run orchestrator.TaskRun, agent domain.Session) (map[string]bool, []string) {
	allowed := map[string]bool{}
	if run.RequestID == "" {
		return allowed, []string{}
	}
	allowed[run.RequestID] = true
	lineages := make([]domain.RequestLineage, 0, len(agent.RequestLineages))
	for _, lineage := range agent.RequestLineages {
		if lineage.RequestID == run.RequestID || lineage.RootRequestID == run.RequestID {
			lineages = append(lineages, lineage)
		}
	}
	sort.Slice(lineages, func(i, j int) bool { return lineages[i].CreatedAt.Before(lineages[j].CreatedAt) })
	ordered := []string{run.RequestID}
	for _, lineage := range lineages {
		if !allowed[lineage.RequestID] {
			allowed[lineage.RequestID] = true
			ordered = append(ordered, lineage.RequestID)
		}
	}
	return allowed, ordered
}

func requestBelongsToRun(requestID string, allowed map[string]bool) bool {
	return requestID == "" || len(allowed) == 0 || allowed[requestID]
}
