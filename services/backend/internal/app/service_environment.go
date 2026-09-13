package app

import (
	"context"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/planner"
	"kernl.local/harness/backend/internal/repomanifest"
	"kernl.local/harness/backend/internal/sandboxenv"
)

// environmentProbeTimeout bounds environment measurement. The section is
// valuable but never load bearing: a slow or unavailable Docker daemon must
// degrade the prompt, never delay or fail the user's request.
const environmentProbeTimeout = 25 * time.Second

// repositoryProbeTimeout bounds repository-topology measurement, for the same
// reason and with the same consequence: a project on a slow filesystem, or one
// with an unreadable submodule, degrades the prompt rather than the request.
// It is much shorter than the environment probe because every command it runs
// is a local Git read with no daemon involved.
const repositoryProbeTimeout = 10 * time.Second

// SetEnvironmentProber installs the sandbox environment prober. Wiring it is
// optional: without one, prompts simply omit the LOCAL EXECUTION ENVIRONMENT
// section, which is exactly the pre-existing behavior.
func (s *Service) SetEnvironmentProber(prober *sandboxenv.Prober) {
	s.environment = prober
}

// executionEnvironmentSection renders the measured environment for a request
// against projectPath. Returns "" when no prober is installed or measurement
// produced nothing renderable.
func (s *Service) executionEnvironmentSection(ctx context.Context, projectPath string) string {
	if s.environment == nil {
		return ""
	}
	probeCtx, cancel := context.WithTimeout(ctx, environmentProbeTimeout)
	defer cancel()
	return s.environment.Manifest(probeCtx, projectPath).Render()
}

// plannerRequest is the single place every planner request is finished. It
// attaches the request's immutable knowledge snapshot and the measured
// execution environment, so no call site can accidentally build a prompt that
// omits either. Callers pass the project path explicitly because a few
// internal continuations construct a request without holding the session.
func (s *Service) plannerRequest(ctx context.Context, base planner.Request, snapshot domain.RequestKnowledgeSnapshot, projectPath string) planner.Request {
	request := withPlannerKnowledge(base, snapshot)
	if request.SessionID != "" {
		if item, err := s.store.Get(request.SessionID); err == nil {
			if request.EffortLevel == "" {
				request.EffortLevel = normalizeEffortLevel(item.EffortLevel)
			}
			// The attempt ledger and the divergence report are attached here,
			// in the one place every planner request is finished, for the same
			// reason knowledge is: no call site can then build a continuation
			// prompt that silently omits what earlier rounds already proved.
			request = s.withContinuationContext(request, item)
		}
	}
	if request.EffortLevel == "" {
		request.EffortLevel = domain.EffortLevelMedium
	}
	request.ExecutionEnvironment = s.executionEnvironmentSection(ctx, projectPath)
	request.RepositoryTopology = s.repositoryTopologySection(ctx, projectPath)
	return request
}

// repositoryTopologySection renders which repositories the project is really
// made of. It is attached at the same seam as the environment, and for the same
// reason: a planner that cannot see it guesses, and for a superproject whose
// source lives in submodules the guess decides whether the request is
// answerable at all.
//
// Returns "" for an ordinary single-repository project and for a project that
// could not be measured. Like the environment section it is descriptive: the
// routing it describes is performed by Wharnex whether or not the planner ever
// reads this.
func (s *Service) repositoryTopologySection(ctx context.Context, projectPath string) string {
	if strings.TrimSpace(projectPath) == "" {
		return ""
	}
	probeCtx, cancel := context.WithTimeout(ctx, repositoryProbeTimeout)
	defer cancel()
	return repomanifest.Measure(probeCtx, projectPath).Render()
}
