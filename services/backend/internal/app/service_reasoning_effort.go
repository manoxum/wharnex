package app

import "kernl.local/harness/backend/internal/domain"

func normalizeReasoningEffort(effort domain.ReasoningEffort) domain.ReasoningEffort {
	if domain.ValidReasoningEffort(effort) {
		return effort
	}
	return domain.ReasoningEffortHigh
}
