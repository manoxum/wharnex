package app

import (
	"testing"

	"kernl.local/harness/backend/internal/domain"
)

func TestAttentionRecordOmitsResolvedBlockedTurnAfterApply(t *testing.T) {
	turn := domain.AgentTurn{Protocol: domain.TurnProtocolV1, Kind: domain.TurnKindBlocked, Message: "remove .git/index.lock"}
	record := attentionRecordFor(domain.Session{
		ID: "ses-applied", State: "applied", LastTurn: &turn, LastManualPrompt: "stale retry prompt",
	})

	if record.LastTurn != nil || record.HasManualPrompt {
		t.Fatalf("applied session still projects resolved operator attention: %+v", record)
	}
}

func TestAttentionRecordKeepsCurrentBlockedTurn(t *testing.T) {
	turn := domain.AgentTurn{Protocol: domain.TurnProtocolV1, Kind: domain.TurnKindBlocked, Message: "operator action required"}
	record := attentionRecordFor(domain.Session{
		ID: "ses-blocked", State: "blocked", LastTurn: &turn, LastManualPrompt: "retry prompt",
	})

	if record.LastTurn == nil || !record.HasManualPrompt {
		t.Fatalf("current operator attention was hidden: %+v", record)
	}
}
