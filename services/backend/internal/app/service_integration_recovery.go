package app

import (
	"context"
	"sort"
	"strings"
	"sync"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/sandbox"
)

// integrationRecoveryLedger remembers which (session, host HEAD, candidates)
// states an automatic recovery already tried, so an Apply that fails again for
// a reason the proof could not see is attempted once per host state, never in
// a loop. A new host commit or a new candidate is a new state.
type integrationRecoveryLedger struct {
	mu        sync.Mutex
	attempted map[string]bool
}

func (l *integrationRecoveryLedger) claim(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.attempted == nil {
		l.attempted = make(map[string]bool)
	}
	if l.attempted[key] {
		return false
	}
	l.attempted[key] = true
	return true
}

// RecoverBlockedIntegrations resumes the host integration of sessions that
// are parked in `failed` holding verified candidates the live host is now
// proven to accept, and returns how many it attempted.
//
// On 2026-09-25 two chats sat in exactly that state for hours: an engine
// defect had made their candidates look conflicting, the planner correctly
// refused to invent a patch for it, and after the defect was fixed nothing
// retried — each needed an operator to press Apply. The Protected approval
// already authorizes a verified candidate's integration (AGENTS.md §2), so
// retrying a proven-clean integration asks for nothing new.
//
// Eligibility is deliberately narrow: Protected with automatic approval, no
// round in flight, no conflict record that is still live, and the whole batch
// proven clean by the same request-base simulation Apply itself runs.
func (s *Service) RecoverBlockedIntegrations(ctx context.Context) int {
	attempted := 0
	for _, item := range s.store.List() {
		if ctx.Err() != nil {
			return attempted
		}
		if !integrationRecoveryEligible(item) {
			continue
		}
		// The scan yields a slim view; the batch proof and Apply need the
		// whole session, baseline snapshots included.
		full, err := s.store.Get(item.ID)
		if err != nil || !integrationRecoveryEligible(full) {
			continue
		}
		item = full
		stateKey, open := s.lockRetryState(item)
		if !open {
			continue
		}
		pending := hostApplicablePendingChanges(pendingHostChanges(item))
		if !s.integrationConflictReleasable(ctx, item, pending) || !pendingBatchProvenClean(ctx, item.ProjectPath, pending) {
			continue
		}
		if s.resumeParkedIntegration(ctx, item, pending, stateKey) {
			attempted++
		}
	}
	return attempted
}

// resumeParkedIntegration re-applies one proven session, once per host state
// (and, for a session the self-evolution lock parked, once per lock state).
func (s *Service) resumeParkedIntegration(ctx context.Context, item domain.Session, pending []domain.PendingHostChange, stateKey string) bool {
	head, err := sandbox.CurrentHeadSHA(ctx, item.ProjectPath)
	if err != nil || !s.integrationRecovery.claim(integrationRecoveryKey(item.ID, head, pending)+"|"+stateKey) {
		return false
	}
	s.bus.Publish(item.ID, "integration.auto_recovery_started", map[string]any{
		"candidates": len(pending), "host_head": head, "failure_kind": item.FailureKind,
		"reason": "every pending candidate is proven to integrate into the live host",
	})
	if _, applyErr := s.ApplyToHost(ctx, item.ID); applyErr != nil {
		s.bus.Publish(item.ID, "integration.auto_recovery_failed", map[string]any{"error": applyErr.Error(), "host_head": head})
		return true
	}
	s.bus.Publish(item.ID, "integration.auto_recovery_completed", map[string]any{"candidates": len(pending), "host_head": head})
	return true
}

func integrationRecoveryEligible(item domain.Session) bool {
	if item.ExecutionMode != domain.ExecutionModeProtected || !domain.AutomationModeApproves(item.AutomationMode) {
		return false
	}
	if (item.State != "failed" && !parkedBySelfEvolutionLock(item)) || item.PlannerInFlight || len(item.PendingManualRequestIDs) > 0 || item.ArchivedAt != nil {
		return false
	}
	return len(hostApplicablePendingChanges(pendingHostChanges(item))) > 0
}

// integrationConflictReleasable reports that Apply's own self-heal will clear
// whatever conflict record the session holds, so it cannot block the retry.
func (s *Service) integrationConflictReleasable(ctx context.Context, item domain.Session, pending []domain.PendingHostChange) bool {
	return item.IntegrationConflict == nil || orphanedIntegrationConflict(item) || s.integrationConflictDissolved(ctx, item, pending)
}

// pendingBatchProvenClean simulates the batch exactly as Apply will merge it.
// Patch-only candidates are proven by applying to the host as it stands; a
// legacy ChangeSet candidate cannot be proven and keeps the session parked.
func pendingBatchProvenClean(ctx context.Context, projectPath string, pending []domain.PendingHostChange) bool {
	chain := make([]sandbox.ChainCandidate, 0, len(pending))
	for _, change := range pending {
		if change.IntegrationBranch == "" {
			if !patchCandidateAppliesToHost(ctx, projectPath, change) {
				return false
			}
			continue
		}
		chain = append(chain, sandbox.ChainCandidate{
			Branch: change.IntegrationBranch, RequestBaseRef: sandbox.RequestBaseRef(change.Plan.RequestID),
			IntegratingUnits: submoduleIntegrationPaths(change.SubmoduleIntegrations),
		})
	}
	if len(chain) == 0 {
		return true
	}
	_, conflict, supported, err := sandbox.PreflightIntegrationChain(ctx, projectPath, chain)
	return err == nil && supported && conflict == nil
}

func integrationRecoveryKey(sessionID, head string, pending []domain.PendingHostChange) string {
	plans := make([]string, 0, len(pending))
	for _, change := range pending {
		plans = append(plans, change.Plan.PlanID+"@"+change.IntegrationCommit)
	}
	sort.Strings(plans)
	return sessionID + "|" + head + "|" + strings.Join(plans, ",")
}
