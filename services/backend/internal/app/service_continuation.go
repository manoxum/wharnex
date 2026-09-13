package app

import (
	"context"
	"encoding/json"
	"strings"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/planner"
)

func marshalIndented(value any) ([]byte, error) { return json.MarshalIndent(value, "", "  ") }

// prepareContinuation is the single preparation step every derived request in a
// Main Request must run, immediately after its context refresh and before its
// prompt is built.
//
// It does two things that were previously done only for the Main Request, and
// whose absence is what made multi-round corrections diverge from the local
// project:
//
//  1. It anchors this request's own base tree. Until now only the Main Request
//     recorded one, so every repair round produced a plan with no anchored base
//     and silently lost the base-rooted integration ADR-0035 introduced — the
//     exact "patch applied to a tree it was not authored against" dead end that
//     ADR removed, reintroduced on precisely the rounds most likely to hit it.
//  2. It measures how the local project diverged from the snapshot the planner
//     already holds, and records that report so the prompt and every transport
//     describe the same divergence.
//
// Both are best effort. A project without Git, or any Git refusal, degrades to
// the previous behavior rather than failing a correction the user asked for.
func (s *Service) prepareContinuation(ctx context.Context, item domain.Session, requestID, parentRequestID string) {
	requestID = strings.TrimSpace(requestID)
	parentRequestID = strings.TrimSpace(parentRequestID)
	if requestID == "" || strings.TrimSpace(item.ProjectPath) == "" {
		return
	}
	baseCommit := s.captureRequestBase(ctx, item.ID, item.ProjectPath, requestID)
	rootID := knowledgeReviewRoot(item, parentRequestID)
	delta := s.computeContextDelta(ctx, item, rootID, requestID, baseCommit.Root)

	var released []string
	_, _ = s.store.Update(item.ID, func(current *domain.Session) error {
		released = recordRequestBaseCommit(current, requestID, baseCommit)
		recordRequestContextDelta(current, requestID, delta)
		return nil
	})
	s.releaseRequestBaseRefs(ctx, item.ID, item.ProjectPath, released)
	if s.bus != nil && delta.Protocol != "" {
		s.bus.Publish(item.ID, "context.delta_measured", map[string]any{
			"request_id": requestID, "base_request_id": delta.BaseRequestID, "source": delta.Source,
			"unchanged": delta.Unchanged, "files": len(delta.Files), "truncated": delta.Truncated,
			"patch_attached": delta.Patch != "",
		})
	}
}

// continuationRound reports where a request sits in its Main Request's
// automated budget. Round is one-based and counts every measured round plus the
// one being prepared, so the planner's "is this my last chance" decision uses
// the same numbers Wharnex enforces.
func continuationRound(item domain.Session, rootID string) (round, bound int) {
	bound = policyForEffort(item.EffortLevel).MaxAttempts
	if ledger := attemptLedgerForRoot(item, rootID); ledger != nil {
		return len(ledger.Rounds) + 1, bound
	}
	return 1, bound
}

// withContinuationContext attaches the attempt ledger and divergence report to
// a planner request. Both are rendered here, from state already persisted by
// prepareContinuation, so every transport and the prompt agree by construction.
func (s *Service) withContinuationContext(request planner.Request, item domain.Session) planner.Request {
	rootID := knowledgeReviewRoot(item, strings.TrimSpace(request.ParentRequestID))
	if rootID == "" {
		rootID = strings.TrimSpace(request.RequestID)
	}
	round, bound := continuationRound(item, rootID)
	request.AttemptRound = round
	request.AttemptBound = bound
	request.AttemptLedger = renderAttemptLedger(attemptLedgerForRoot(item, rootID), round, bound)
	if delta, ok := requestContextDelta(item, request.RequestID); ok {
		request.ContextDelta = renderContextDelta(delta)
	}
	return request
}

// continuationArtifacts materializes the request-side files of
// harness.attempts/v1 and harness.context-delta/v1 for one request.
//
// Every transport (Desktop archive, remote one-shot ZIP, live channel file map)
// writes exactly these, so a planner that reads files rather than prose sees
// the identical evidence the prompt describes.
type continuationArtifact struct {
	Name string
	Raw  []byte
}

// ContinuationArtifact is one request-side continuation file exposed to the
// Desktop transport. Name is a fixed Wharnex-generated bundle path; Raw is the
// exact bytes the prompt described.
type ContinuationArtifact struct {
	Name string
	Raw  []byte
}

// RequestContinuationArtifacts returns the harness.attempts/v1 and
// harness.context-delta/v1 files one request must carry, so the Desktop can
// expand them into the outer ChatGPT archive alongside the knowledge records.
func (s *Service) RequestContinuationArtifacts(sessionID, requestID string) []ContinuationArtifact {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return nil
	}
	internal := continuationArtifacts(item, requestID)
	out := make([]ContinuationArtifact, 0, len(internal))
	for _, artifact := range internal {
		out = append(out, ContinuationArtifact{Name: artifact.Name, Raw: artifact.Raw})
	}
	return out
}

func continuationArtifacts(item domain.Session, requestID string) []continuationArtifact {
	requestID = strings.TrimSpace(requestID)
	if requestID == "" {
		return nil
	}
	lineage, ok := item.RequestLineages[requestID]
	rootID := requestID
	if ok && lineage.RootRequestID != "" {
		rootID = lineage.RootRequestID
	}
	out := make([]continuationArtifact, 0, 3)
	if ledger := attemptLedgerForRoot(item, rootID); ledger != nil {
		round, bound := continuationRound(item, rootID)
		if state := attemptLedgerStateJSON(ledger, requestID, round, bound); state != nil {
			if raw, err := marshalIndented(state); err == nil {
				out = append(out, continuationArtifact{Name: "attempts/state.json", Raw: raw})
			}
		}
		if narrative := strings.TrimSpace(ledger.Narrative); narrative != "" {
			out = append(out, continuationArtifact{Name: "attempts/ledger.md", Raw: []byte(narrative)})
		}
	}
	if delta, exists := requestContextDelta(item, requestID); exists {
		if raw, err := marshalIndented(delta); err == nil {
			out = append(out, continuationArtifact{Name: "context-delta/delta.json", Raw: raw})
		}
		if delta.Patch != "" {
			out = append(out, continuationArtifact{Name: "context-delta/delta.patch", Raw: []byte(delta.Patch)})
		}
	}
	return out
}
