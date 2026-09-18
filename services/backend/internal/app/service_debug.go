package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/protocol"
)

func (s *Service) SetDebugEnabled(sessionID string, enabled bool) (domain.Session, error) {
	item, err := s.store.Update(sessionID, func(current *domain.Session) error {
		current.DebugEnabled = enabled
		current.DebugApprovedRootID = ""
		current.DebugApprovedPlanID = ""
		current.InteractiveGrant = nil
		return nil
	})
	if err == nil {
		s.bus.Publish(sessionID, "debug.mode_changed", map[string]any{"enabled": enabled})
	}
	return item, err
}

func debugRootRequestID(item domain.Session, requestID string) string {
	if lineage, ok := item.RequestLineages[requestID]; ok && lineage.RootRequestID != "" {
		return lineage.RootRequestID
	}
	return requestID
}

func debugPlanAuthorized(item domain.Session, plan *domain.ExecutionPlan) bool {
	if plan == nil || plan.Debug == nil {
		return false
	}
	if plan.Debug.Protocol == domain.InteractiveProtocolV2 {
		return interactiveGrantCovers(item, plan)
	}
	if plan.Debug.Target == "host" && plan.Debug.EffectiveAccess() == domain.DebugAccessModify {
		return item.DebugApprovedPlanID == plan.PlanID
	}
	return item.DebugEnabled || item.DebugApprovedRootID == debugRootRequestID(item, plan.RequestID)
}

func debugAuthorized(item domain.Session) bool { return debugPlanAuthorized(item, item.Plan) }

func (s *Service) ApproveDebug(ctx context.Context, sessionID string) (BundleSubmission, error) {
	current, err := s.store.Get(sessionID)
	if err != nil {
		return BundleSubmission{}, err
	}
	if current.Plan == nil || current.Plan.Debug == nil || current.State != "debug_approval_required" {
		return BundleSubmission{Session: current}, errors.New("no debug flow is awaiting approval")
	}
	if err := protocol.ValidateWorkflowPlan(*current.Plan); err != nil {
		return BundleSubmission{Session: current}, err
	}
	rootID := debugRootRequestID(current, current.Plan.RequestID)
	access := current.Plan.Debug.EffectiveAccess()
	updated, err := s.store.Update(sessionID, func(item *domain.Session) error {
		if current.Plan.Debug.Protocol == domain.InteractiveProtocolV2 {
			grant, grantErr := interactiveGrantForPlan(*item, current.Plan)
			if grantErr != nil {
				return grantErr
			}
			item.InteractiveGrant = grant
		} else if current.Plan.Debug.Target == "host" && access == domain.DebugAccessModify {
			item.DebugApprovedPlanID = current.Plan.PlanID
		} else {
			item.DebugApprovedRootID = rootID
		}
		item.State = "workflow_planned"
		return nil
	})
	if err != nil {
		return BundleSubmission{Session: current}, err
	}
	s.bus.Publish(sessionID, "debug.approved", map[string]any{
		"root_request_id": rootID, "plan_id": updated.Plan.PlanID,
		"target": updated.Plan.Debug.Target, "access": updated.Plan.Debug.EffectiveAccess(),
		"protocol": updated.Plan.Debug.Protocol, "capabilities": updated.Plan.Debug.Capabilities,
	})
	return s.runWorkflowLoop(ctx, sessionID, "debug_approved")
}

func interactiveGrantForPlan(item domain.Session, plan *domain.ExecutionPlan) (*domain.InteractiveGrant, error) {
	if plan == nil || plan.Debug == nil || plan.Debug.Protocol != domain.InteractiveProtocolV2 {
		return nil, errors.New("interactive v2 plan is required")
	}
	digest, err := interactivePlanDigest(plan)
	if err != nil {
		return nil, err
	}
	capabilities := append([]string(nil), plan.Debug.Capabilities...)
	sort.Strings(capabilities)
	oneShot := plan.Debug.EffectiveAccess() == domain.DebugAccessModify
	grant := &domain.InteractiveGrant{
		Protocol: domain.InteractiveProtocolV2, PolicyRevision: domain.InteractivePolicyRevisionV2, RootRequestID: debugRootRequestID(item, plan.RequestID),
		Access: plan.Debug.EffectiveAccess(), Target: plan.Debug.Target, Capabilities: capabilities,
		Scope: plan.Debug.Scope, Digest: digest, OneShot: oneShot, GrantedAt: time.Now().UTC(),
	}
	if oneShot {
		grant.PlanID = plan.PlanID
	}
	return grant, nil
}

func interactiveGrantCovers(item domain.Session, plan *domain.ExecutionPlan) bool {
	grant := item.InteractiveGrant
	if grant == nil || plan == nil || plan.Debug == nil || plan.Debug.Protocol != domain.InteractiveProtocolV2 {
		return false
	}
	if grant.Protocol != domain.InteractiveProtocolV2 || grant.PolicyRevision != domain.InteractivePolicyRevisionV2 || grant.RootRequestID != debugRootRequestID(item, plan.RequestID) || grant.Target != plan.Debug.Target {
		return false
	}
	if plan.Debug.EffectiveAccess() == domain.DebugAccessModify {
		if !grant.OneShot || grant.PlanID != plan.PlanID || grant.Access != domain.DebugAccessModify {
			return false
		}
		digest, err := interactivePlanDigest(plan)
		return err == nil && digest == grant.Digest
	}
	if grant.Access != domain.DebugAccessObserve || !capabilitySubset(plan.Debug.Capabilities, grant.Capabilities) || !scopeSubset(plan.Debug.Scope, grant.Scope) {
		return false
	}
	return true
}

func interactivePlanDigest(plan *domain.ExecutionPlan) (string, error) {
	payload := struct {
		Protocol string                  `json:"protocol"`
		Target   string                  `json:"target"`
		Access   string                  `json:"access"`
		Caps     []string                `json:"capabilities"`
		Scope    domain.InteractiveScope `json:"scope"`
		Ops      []domain.Operation      `json:"operations"`
	}{Protocol: plan.Debug.Protocol, Target: plan.Debug.Target, Access: plan.Debug.EffectiveAccess(), Caps: append([]string(nil), plan.Debug.Capabilities...), Scope: plan.Debug.Scope, Ops: plan.Operations}
	sort.Strings(payload.Caps)
	raw, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256(raw)
	return hex.EncodeToString(digest[:]), nil
}

func capabilitySubset(want, have []string) bool {
	set := make(map[string]bool, len(have))
	for _, value := range have {
		set[value] = true
	}
	for _, value := range want {
		if !set[value] {
			return false
		}
	}
	return true
}

func scopeSubset(want, have domain.InteractiveScope) bool {
	return stringsSubset(want.Paths, have.Paths) && stringsSubset(want.Connections, have.Connections) &&
		stringsSubset(want.LogSources, have.LogSources) && stringsSubset(want.Processes, have.Processes) &&
		stringsSubset(want.Services, have.Services) && stringsSubset(want.Containers, have.Containers) &&
		stringsSubset(want.NetworkDestinations, have.NetworkDestinations)
}

func stringsSubset(want, have []string) bool {
	set := make(map[string]bool, len(have))
	for _, value := range have {
		set[strings.TrimSpace(value)] = true
	}
	for _, value := range want {
		if !set[strings.TrimSpace(value)] {
			return false
		}
	}
	return true
}
