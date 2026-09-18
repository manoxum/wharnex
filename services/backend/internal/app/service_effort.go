package app

import (
	"strconv"

	"kernl.local/harness/backend/internal/domain"
)

// maxAutoRepairAttempts is retained as the historical Medium default for
// compatibility tests and bounded diagnostic history only. Runtime retry
// gating is always derived from EffortLevel.
const maxAutoRepairAttempts = 3

type effortPolicy struct {
	MaxAttempts           int
	ContinuousImprovement bool
}

func normalizeEffortLevel(level domain.EffortLevel) domain.EffortLevel {
	if !domain.ValidEffortLevel(level) {
		return domain.EffortLevelMedium
	}
	return level
}

func policyForEffort(level domain.EffortLevel) effortPolicy {
	switch normalizeEffortLevel(level) {
	case domain.EffortLevelLow:
		return effortPolicy{MaxAttempts: 1}
	case domain.EffortLevelMedium:
		return effortPolicy{MaxAttempts: 3}
	case domain.EffortLevelHigh:
		return effortPolicy{MaxAttempts: 6}
	case domain.EffortLevelExtraHigh:
		return effortPolicy{MaxAttempts: 10, ContinuousImprovement: true}
	case domain.EffortLevelMax:
		return effortPolicy{MaxAttempts: 15, ContinuousImprovement: true}
	case domain.EffortLevelUltra:
		return effortPolicy{MaxAttempts: 30, ContinuousImprovement: true}
	case domain.EffortLevelLoop:
		return effortPolicy{ContinuousImprovement: true}
	default:
		return effortPolicy{MaxAttempts: 3}
	}
}

func structuredInterviewTurn(turn *domain.AgentTurn) bool {
	if turn == nil || turn.Kind != domain.TurnKindClarification || turn.Interview == nil || turn.Outcome == nil || turn.Outcome.Status != domain.TurnOutcomeCompleted {
		return false
	}
	return turn.Interview.Protocol == domain.InterviewProtocolV1 || turn.Interview.Protocol == domain.InterviewProtocolV2
}

// creditStructuredInterviewRound removes the planner round that produced an
// interview from the autonomous effort budget. The eventual substantive
// answer/change still consumes its normal attempt; any number of human
// clarification waves therefore costs zero budget by itself.
func creditStructuredInterviewRound(item *domain.Session, turn *domain.AgentTurn) {
	if structuredInterviewTurn(turn) && item.AutomationAttempt > 0 {
		item.AutomationAttempt--
	}
}

func automaticAttemptsSpent(item domain.Session) int {
	if item.AutomationAttempt > 0 {
		return item.AutomationAttempt
	}
	// Sessions persisted before effort levels existed only tracked repair
	// rounds. Reconstruct a conservative total so upgrading cannot silently
	// reset an in-flight request's autonomous budget. Credit only the current
	// interview round; prior repair/conflict work must remain accounted.
	if item.RepairAttempt > 0 || item.ConflictAttempt > 0 {
		spentRounds := item.RepairAttempt
		if item.ConflictAttempt > spentRounds {
			spentRounds = item.ConflictAttempt
		}
		total := spentRounds + 1
		if structuredInterviewTurn(item.LastTurn) {
			total--
		}
		return total
	}
	if item.LastRequestID != "" || item.Plan != nil {
		if structuredInterviewTurn(item.LastTurn) {
			return 0
		}
		return 1
	}
	return 0
}

func effortAttemptAvailable(item domain.Session) bool {
	policy := policyForEffort(item.EffortLevel)
	return policy.MaxAttempts == 0 || automaticAttemptsSpent(item) < policy.MaxAttempts
}

func conflictResolutionExhausted(item domain.Session) bool {
	policy := policyForEffort(item.EffortLevel)
	if policy.MaxAttempts > 0 && item.ConflictAttempt >= policy.MaxAttempts {
		return true
	}
	return item.AutomationMode == domain.AutomationModeAuto && !effortAttemptAvailable(item)
}

func effortAttemptLabel(item domain.Session, next int) string {
	policy := policyForEffort(item.EffortLevel)
	if policy.MaxAttempts == 0 {
		return "attempt " + strconv.Itoa(next) + " with no fixed limit"
	}
	return "attempt " + strconv.Itoa(next) + " of " + strconv.Itoa(policy.MaxAttempts)
}

func shouldContinueImprovement(item domain.Session) bool {
	policy := policyForEffort(item.EffortLevel)
	return item.AutomationMode == domain.AutomationModeAuto && policy.ContinuousImprovement && effortAttemptAvailable(item)
}
