package app

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/audit"
	"kernl.local/harness/backend/internal/changeset"
	"kernl.local/harness/backend/internal/domain"
)

// ErrIntegrationStaging marks a host Apply that never reached a host write
// because building the merged candidate failed.
//
// It is separated from a plain conflict because the two need opposite
// handling: a conflict already has a focused resolution flow, while a staging
// failure used to leave Apply with a raw plumbing error that no recovery path
// claimed. That combination is what stalled a request indefinitely with a
// bundle that was already verified.
var ErrIntegrationStaging = errors.New("changeset integration could not be staged")

// publishReconciliationEvidence records how each moved path was merged. A
// candidate that integrated only because the token tier caught a
// line-granularity artefact is a different event from one that never collided,
// and Apply evidence has to be able to tell them apart afterwards.
func publishReconciliationEvidence(bus *audit.Bus, sessionID string, reconciliations []changeset.Reconciliation) {
	if bus == nil {
		return
	}
	sublinePaths := make([]string, 0)
	linePaths := make([]string, 0)
	resolvedHunks := 0
	for _, item := range reconciliations {
		switch item.Tier {
		case changeset.MergeTierToken:
			sublinePaths = append(sublinePaths, item.Path)
			resolvedHunks += item.TokenResolved
		case changeset.MergeTierLine:
			linePaths = append(linePaths, item.Path)
		}
	}
	if len(sublinePaths) == 0 && len(linePaths) == 0 {
		return
	}
	// The keys say "subline" rather than "token": the audit bus redacts any
	// field whose name contains "token", so the honest name would erase the
	// evidence it is meant to carry.
	bus.Publish(sessionID, "integration.reconciled_locally", map[string]any{
		"line_merged_paths":      linePaths,
		"subline_merged_paths":   sublinePaths,
		"subline_resolved_hunks": resolvedHunks,
		"planner_rounds_needed":  0,
	})
}

// hostApplyNetworkRetries bounds the local Apply retries spent on a transient
// dependency-fetch fault. Two is enough to ride out a DNS answer that did not
// come; more would be waiting on an outage rather than a blip.
const hostApplyNetworkRetries = 2

// hostApplyNetworkBackoff is the pause between those retries.
var hostApplyNetworkBackoff = 15 * time.Second

// applyToHostWithLocalRetry retries a host Apply that failed only because a
// package manager could not reach the network.
//
// Such a failure says nothing about the candidate: the same bytes build
// successfully once the network answers. Routing it to a planner round asks
// for a source rewrite that cannot be the fix, and stopping for a human asks
// them to press a button whose only effect is to try again. So the engine
// tries again itself, a bounded number of times, and only then lets the
// failure take its normal path.
func (s *Service) applyToHostWithLocalRetry(ctx context.Context, sessionID string) (domain.Session, error) {
	item, err := s.ApplyToHost(ctx, sessionID)
	for attempt := 1; attempt <= hostApplyNetworkRetries; attempt++ {
		if err == nil || !isDependencyNetworkDiagnostic(err.Error()) {
			return item, err
		}
		s.bus.Publish(sessionID, "integration.network_retry", map[string]any{
			"attempt": attempt, "max_attempts": hostApplyNetworkRetries,
			"error": truncateRepairText(err.Error(), 512),
		})
		select {
		case <-ctx.Done():
			return item, err
		case <-time.After(hostApplyNetworkBackoff):
		}
		item, err = s.ApplyToHost(ctx, sessionID)
	}
	return item, err
}

// integrationEscalation is the decision about who resolves an integration
// outcome the local ladder could not.
type integrationEscalation struct {
	// Automatic is true when Wharnex dispatches the correction itself. A
	// verified candidate that only needs reconciling is engine work, and
	// pausing it on a confirmation dialog is what turned every collision into
	// a manual step.
	Automatic bool
	// Reason is the operator-facing explanation, always populated.
	Reason string
	// Complexity is the hardest class among the unresolved conflicts.
	Complexity domain.ConflictComplexity
}

// classifyIntegrationEscalation decides whether the planner should be asked to
// resolve what the local ladder could not, and says why in both directions.
//
// The budget is the effort level's, not a separate one: automatic escalation
// spends the attempts the operator already chose when they selected the effort
// for this session. When those are gone the request stops and waits for a
// human, which is the only point at which a human is actually needed.
func classifyIntegrationEscalation(item domain.Session, conflicts []domain.IntegrationConflictDetail) integrationEscalation {
	complexity := hardestComplexity(conflicts)
	if item.AutomationMode != domain.AutomationModeAuto {
		return integrationEscalation{Reason: "manual automation mode: the operator dispatches the correction request", Complexity: complexity}
	}
	if conflictResolutionExhausted(item) {
		return integrationEscalation{
			Reason:     "effort budget for this request is spent; human approval is required before another planner round",
			Complexity: complexity,
		}
	}
	if complexity == domain.ConflictComplexityStructural {
		return integrationEscalation{
			Reason:     "structural collision has no patch-expressible resolution; a planner round cannot answer it",
			Complexity: complexity,
		}
	}
	return integrationEscalation{
		Automatic:  true,
		Reason:     "local reconciliation ladder was exhausted; " + effortAttemptLabel(item, item.ConflictAttempt+1) + " dispatched automatically",
		Complexity: complexity,
	}
}

// hardestComplexity reports the class that decides the escalation for the
// whole set: one structural path makes the set structural.
func hardestComplexity(conflicts []domain.IntegrationConflictDetail) domain.ConflictComplexity {
	hardest := domain.ConflictComplexityMechanical
	for _, conflict := range conflicts {
		switch conflict.Complexity {
		case domain.ConflictComplexityStructural:
			return domain.ConflictComplexityStructural
		case domain.ConflictComplexitySemantic:
			hardest = domain.ConflictComplexitySemantic
		}
	}
	return hardest
}

// conflictComplexitySummary renders the integrator's own assessment for the
// resolver. Three versions of a file say what differs; this says what the
// engine already tried, so a planner round does not re-propose the mechanical
// reconciliation that was attempted and rejected before it was asked.
func conflictComplexitySummary(conflicts []domain.IntegrationConflictDetail) string {
	lines := make([]string, 0, len(conflicts))
	for _, conflict := range conflicts {
		detail := conflict.Path + ": " + conflict.Reason
		if conflict.Complexity != "" {
			detail += " (" + string(conflict.Complexity) + ")"
		}
		if conflict.Hunks > 0 {
			detail += "; Wharnex merged " + strconv.Itoa(conflict.ResolvedHunks) + " of " + strconv.Itoa(conflict.Hunks) +
				" conflicting hunks locally at token granularity and could not merge the rest"
		}
		lines = append(lines, "- "+detail)
	}
	if len(lines) == 0 {
		return ""
	}
	return "LOCAL RECONCILIATION ALREADY ATTEMPTED BY WHARNEX:\n" + strings.Join(lines, "\n")
}
