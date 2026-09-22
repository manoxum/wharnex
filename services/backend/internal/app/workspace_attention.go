package app

import (
	"sort"
	"time"

	"kernl.local/harness/backend/internal/domain"
)

// Compact attention projection.
//
// The attention center only needs to know whether a chat wants the user's
// attention. It used to learn that by fetching each chat's whole Session, one
// request per chat: those payloads are 1-2 MB each (context manifests, pending
// patches, artifact inventories, baselines), so a workspace with thirty chats
// pulled and parsed tens of megabytes on every poll. That blocked the
// renderer's main thread long enough for the window to be killed and restarted
// in a loop.
//
// This returns the same decision inputs for every chat in one small response.
// Heavy collections are reduced to the counts the UI actually reads.

type AttentionRecord struct {
	SessionID               string                 `json:"session_id"`
	ChatID                  string                 `json:"chat_id"`
	State                   string                 `json:"state"`
	ExecutionMode           domain.ExecutionMode   `json:"execution_mode,omitempty"`
	FailureKind             string                 `json:"failure_kind,omitempty"`
	LastRequestID           string                 `json:"last_request_id,omitempty"`
	LastRepairError         string                 `json:"last_repair_error,omitempty"`
	LastTurn                *domain.AgentTurn      `json:"last_turn,omitempty"`
	Policy                  *domain.PolicyDecision `json:"policy,omitempty"`
	HasPlan                 bool                   `json:"has_plan"`
	PlanID                  string                 `json:"plan_id,omitempty"`
	PlanRequestID           string                 `json:"plan_request_id,omitempty"`
	HasPlanDocument         bool                   `json:"has_plan_document,omitempty"`
	DebugTarget             string                 `json:"debug_target,omitempty"`
	DebugAccess             string                 `json:"debug_access,omitempty"`
	DebugRationale          string                 `json:"debug_rationale,omitempty"`
	LastExecPlanID          string                 `json:"last_execution_plan_id,omitempty"`
	PendingCount            int                    `json:"pending_host_changes"`
	PendingManualCount      int                    `json:"pending_manual_requests,omitempty"`
	PlannerInFlight         bool                   `json:"planner_in_flight,omitempty"`
	HasManualPrompt         bool                   `json:"has_manual_prompt,omitempty"`
	SelfEvolution           bool                   `json:"self_evolution,omitempty"`
	SelfEvolutionActivation string                 `json:"self_evolution_activation,omitempty"`
	SelfEvolutionImpacts    []string               `json:"self_evolution_impacts,omitempty"`
	LastHostAppliedAt       string                 `json:"last_host_applied_at,omitempty"`
	PendingKnowledgeReview  string                 `json:"pending_knowledge_review_request_id,omitempty"`
	Conflict                *AttentionConflict     `json:"integration_conflict,omitempty"`
	Interrupted             *AttentionInterrupted  `json:"interrupted_execution,omitempty"`
}

type AttentionConflict struct {
	ID        string `json:"id"`
	PathCount int    `json:"path_count"`
}

type AttentionInterrupted struct {
	PlanID string `json:"plan_id"`
	Status string `json:"status"`
}

// WorkspaceAttention returns one compact record per session of a project.
func (s *Service) WorkspaceAttention(projectPath string) ([]AttentionRecord, error) {
	project, err := normalizeProjectPath(projectPath)
	if err != nil {
		return nil, err
	}
	sessions := s.store.List()

	records := make([]AttentionRecord, 0, 32)
	for _, item := range sessions {
		if item.ProjectPath != project {
			continue
		}
		records = append(records, attentionRecordFor(item))
	}
	sort.Slice(records, func(i, j int) bool { return records[i].SessionID > records[j].SessionID })
	return records, nil
}

func attentionRecordFor(item domain.Session) AttentionRecord {
	record := AttentionRecord{
		SessionID:               item.ID,
		ChatID:                  item.ChatID,
		State:                   item.State,
		ExecutionMode:           item.ExecutionMode,
		FailureKind:             item.FailureKind,
		LastRequestID:           item.LastRequestID,
		LastRepairError:         truncateRepairText(item.LastRepairError, 2048),
		LastTurn:                currentAttentionTurn(item),
		Policy:                  item.Policy,
		PendingCount:            len(item.PendingHostChanges),
		PendingManualCount:      len(item.PendingManualRequestIDs),
		PlannerInFlight:         item.PlannerInFlight,
		HasManualPrompt:         currentAttentionPrompt(item),
		SelfEvolution:           item.SelfEvolution,
		SelfEvolutionActivation: item.SelfEvolutionActivation,
		SelfEvolutionImpacts:    append([]string(nil), item.SelfEvolutionImpacts...),
		PendingKnowledgeReview:  item.PendingKnowledgeReviewRequestID,
	}
	if !item.LastHostAppliedAt.IsZero() {
		record.LastHostAppliedAt = item.LastHostAppliedAt.UTC().Format(time.RFC3339Nano)
	}
	if item.Plan != nil {
		record.HasPlan = true
		record.PlanID = item.Plan.PlanID
		record.PlanRequestID = item.Plan.RequestID
		record.HasPlanDocument = item.Plan.Document != ""
		if item.Plan.Debug != nil {
			record.DebugTarget = item.Plan.Debug.Target
			record.DebugAccess = item.Plan.Debug.EffectiveAccess()
			record.DebugRationale = truncateRepairText(item.Plan.Debug.Rationale, 1024)
		}
	}
	if item.LastExecution != nil {
		record.LastExecPlanID = item.LastExecution.PlanID
	}
	if item.IntegrationConflict != nil {
		record.Conflict = &AttentionConflict{ID: item.IntegrationConflict.ID, PathCount: len(item.IntegrationConflict.Paths)}
	}
	if item.InterruptedExecution != nil {
		record.Interrupted = &AttentionInterrupted{PlanID: item.InterruptedExecution.PlanID, Status: item.InterruptedExecution.Status}
	}
	return record
}

// LastTurn is durable conversation history, not necessarily current work. Only
// the states created by a clarification/blocked turn make those two turn kinds
// actionable; a later successful Apply must not resurrect their old remedy in
// the attention center.
func currentAttentionTurn(item domain.Session) *domain.AgentTurn {
	if item.LastTurn == nil {
		return nil
	}
	switch item.LastTurn.Kind {
	case domain.TurnKindClarification:
		if item.State != "awaiting_clarification" {
			return nil
		}
	case domain.TurnKindBlocked:
		if item.State != "blocked" && item.State != "failed" {
			return nil
		}
	}
	return item.LastTurn
}

func currentAttentionPrompt(item domain.Session) bool {
	if item.LastManualPrompt == "" {
		return false
	}
	return item.State != "applied" && item.State != "reverted"
}
