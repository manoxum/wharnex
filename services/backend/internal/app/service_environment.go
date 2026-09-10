package app

import (
	"context"
	"time"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/planner"
	"kernl.local/harness/backend/internal/sandboxenv"
)

// environmentProbeTimeout bounds environment measurement. The section is
// valuable but never load bearing: a slow or unavailable Docker daemon must
// degrade the prompt, never delay or fail the user's request.
const environmentProbeTimeout = 25 * time.Second

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
	if request.EffortLevel == "" && request.SessionID != "" {
		if item, err := s.store.Get(request.SessionID); err == nil {
			request.EffortLevel = normalizeEffortLevel(item.EffortLevel)
		}
	}
	if request.EffortLevel == "" {
		request.EffortLevel = domain.EffortLevelMedium
	}
	request.ExecutionEnvironment = s.executionEnvironmentSection(ctx, projectPath)
	return request
}
