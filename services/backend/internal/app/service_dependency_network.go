package app

import (
	"context"
	"errors"
	"path/filepath"
	"strings"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/sandbox"
	"kernl.local/harness/backend/internal/selfevolution"
)

// goDependencyHydrationTimeoutSeconds bounds the single network-approved
// `go mod download` operation injected by RetryDependencyNetwork.
const goDependencyHydrationTimeoutSeconds = 900

// offlineGoModuleCacheReasonCodes is the closed set of planner-reported
// reason codes that Wharness recognizes as the same local infrastructure
// fault the sandbox itself raises as sandbox.ErrOfflineDependenciesUnavailable.
// This set is intentionally small and reviewed by hand: a reason code is
// planner-supplied text, so admitting it here is a deliberate trust decision,
// never an automatic one.
var offlineGoModuleCacheReasonCodes = map[string]bool{
	"offline_host_go_module_cache": true, // observed in production
	"offline_go_module_cache":      true,
	"offline_sandbox_dependencies": true,
	"go_module_cache_unavailable":  true,
	"go_mod_cache_offline":         true,
}

var nonRepairablePlannerReasonCodes = map[string]string{
	"host_build_toolchain_mismatch":   domain.FailureKindHostBuildToolchain,
	"host_toolchain_mismatch":         domain.FailureKindHostBuildToolchain,
	"self_evolution_transaction_busy": domain.FailureKindSelfEvolutionBusy,
	"self_evolution_busy":             domain.FailureKindSelfEvolutionBusy,
	"stale_pending_baseline":          domain.FailureKindStaleHostBaseline,
	"stale_host_baseline":             domain.FailureKindStaleHostBaseline,
	"host_integration_race":           domain.FailureKindHostIntegrationRace,
	"integration_race":                domain.FailureKindHostIntegrationRace,
}

// classifyExecutionFailure derives a domain.FailureKind from a Wharness
// sandbox-raised execution error. It is the authoritative classifier: the
// error originates entirely inside Wharness, never from planner text.
func classifyExecutionFailure(cause error) string {
	if errors.Is(cause, sandbox.ErrOfflineDependenciesUnavailable) {
		return domain.FailureKindOfflineGoModuleCache
	}
	if errors.Is(cause, selfevolution.ErrHostBuildToolchainMismatch) {
		return domain.FailureKindHostBuildToolchain
	}
	if errors.Is(cause, selfevolution.ErrBusy) {
		return domain.FailureKindSelfEvolutionBusy
	}
	if errors.Is(cause, ErrStaleHostBaseline) {
		return domain.FailureKindStaleHostBaseline
	}
	if errors.Is(cause, ErrHostIntegrationRace) {
		return domain.FailureKindHostIntegrationRace
	}
	if errors.Is(cause, context.Canceled) {
		return domain.FailureKindExecutionCanceled
	}
	return ""
}

// classifyPlannerOutcomeFailure derives a domain.FailureKind from a planner
// turn outcome. The reason_code lookup is the primary signal; the message
// substring fallback catches a planner that echoes Wharness's own error text
// under a reason code Wharness does not yet recognize. It is deliberately a
// fallback and not the primary key: reason_code is a stable, closed-vocabulary
// field the planner is instructed to set, while message is free prose.
func classifyPlannerOutcomeFailure(outcome *domain.TurnOutcome) string {
	if outcome == nil || outcome.Status == domain.TurnOutcomeCompleted {
		return ""
	}
	reasonCode := strings.ToLower(strings.TrimSpace(outcome.ReasonCode))
	if offlineGoModuleCacheReasonCodes[reasonCode] {
		return domain.FailureKindOfflineGoModuleCache
	}
	if kind := nonRepairablePlannerReasonCodes[reasonCode]; kind != "" {
		return kind
	}
	message := strings.ToLower(outcome.Message)
	if strings.Contains(message, sandbox.ErrOfflineDependenciesUnavailable.Error()) {
		return domain.FailureKindOfflineGoModuleCache
	}
	if selfevolution.IsHostToolchainMismatch(outcome.Message) {
		return domain.FailureKindHostBuildToolchain
	}
	if strings.Contains(message, strings.ToLower(selfevolution.ErrBusy.Error())) {
		return domain.FailureKindSelfEvolutionBusy
	}
	if strings.Contains(message, "host apply blocked by stale baseline") {
		return domain.FailureKindStaleHostBaseline
	}
	if strings.Contains(message, strings.ToLower(ErrHostIntegrationRace.Error())) {
		return domain.FailureKindHostIntegrationRace
	}
	return ""
}

// sessionFailureKind is the read path every consumer of a session's failure
// classification MUST go through, instead of reading item.FailureKind
// directly. It derives the legacy case for sessions persisted before
// FailureKind existed, whose LastRepairError still carries only prose. The
// prose fallback is a compatibility shim for already-persisted sessions and
// can be deleted once FailureKind has been populated for a full release.
func sessionFailureKind(item domain.Session) string {
	if item.FailureKind != "" {
		return item.FailureKind
	}
	sentinel := sandbox.ErrOfflineDependenciesUnavailable.Error()
	if strings.Contains(item.LastRepairError, sentinel) {
		return domain.FailureKindOfflineGoModuleCache
	}
	if item.LastExecution != nil && strings.Contains(item.LastExecution.Error, sentinel) {
		return domain.FailureKindOfflineGoModuleCache
	}
	if selfevolution.IsHostToolchainMismatch(item.LastRepairError) {
		return domain.FailureKindHostBuildToolchain
	}
	if item.LastExecution != nil && selfevolution.IsHostToolchainMismatch(item.LastExecution.Error) {
		return domain.FailureKindHostBuildToolchain
	}
	legacyDetails := []string{item.LastRepairError}
	if item.LastExecution != nil {
		legacyDetails = append(legacyDetails, item.LastExecution.Error)
	}
	for _, detail := range legacyDetails {
		legacyDetail := strings.ToLower(detail)
		if strings.Contains(legacyDetail, strings.ToLower(selfevolution.ErrBusy.Error())) {
			return domain.FailureKindSelfEvolutionBusy
		}
		if strings.Contains(legacyDetail, "host apply blocked by stale baseline") || strings.Contains(legacyDetail, "stale_pending_baseline") {
			return domain.FailureKindStaleHostBaseline
		}
		if strings.Contains(legacyDetail, strings.ToLower(ErrHostIntegrationRace.Error())) {
			return domain.FailureKindHostIntegrationRace
		}
		if strings.Contains(legacyDetail, context.Canceled.Error()) {
			return domain.FailureKindExecutionCanceled
		}
	}
	return ""
}

// clearSessionFailure resets a session's failure classification together
// with its prose. The two fields must never be cleared independently, or a
// stale FailureKind can outlive the LastRepairError that justified it (or
// vice versa) and mislead the next recovery decision.
func clearSessionFailure(current *domain.Session) {
	current.LastRepairError = ""
	current.FailureKind = ""
}

// RetryDependencyNetwork is an explicit human-approved recovery for a narrowly
// classified missing Go module cache. It never grants network to arbitrary
// model commands and never changes the host project directly.
func (s *Service) RetryDependencyNetwork(ctx context.Context, sessionID string, approved bool) (domain.Session, error) {
	if !approved {
		return domain.Session{}, ErrApprovalRequired
	}
	current, err := s.store.Get(sessionID)
	if err != nil {
		return current, err
	}
	if current.ExecutionMode != domain.ExecutionModeProtected {
		return current, errors.New("dependency network recovery requires Protected execution")
	}
	if current.State != "failed" || current.Plan == nil || current.LastExecution == nil || current.LastExecution.PlanID != current.Plan.PlanID {
		return current, errors.New("dependency network recovery requires the currently failed plan")
	}
	if sessionFailureKind(current) != domain.FailureKindOfflineGoModuleCache {
		return current, errors.New("no offline dependency failure is available to retry")
	}

	updated, err := s.store.Update(sessionID, func(item *domain.Session) error {
		injected := injectGoDependencyHydration(item.Plan)
		if !injected && !hasGoDependencyHydration(item.Plan) {
			return errors.New("the failed plan has no eligible Go dependency command")
		}
		decision := s.policy.Evaluate(*item.Plan)
		item.Policy = &decision
		clearSessionFailure(item)
		return nil
	})
	if err != nil {
		return current, err
	}
	s.bus.Publish(sessionID, "sandbox.dependency_network_approved", map[string]any{"plan_id": updated.Plan.PlanID, "scope": "go_dependency_commands"})
	_, executed, err := s.Execute(ctx, sessionID, true)
	return executed, err
}

// goDependencyHydrationCommand is the single network-approved operation the
// SoT allows: it resolves modules into .kernl/go-mod inside the isolated
// sandbox workspace. Every other command in the plan keeps network=false and
// runs against that private cache with GOPROXY=off — see SANDBOX_MODEL.md.
// The `all` pattern is intentionally absent; see goModuleInventoryCommand in
// internal/sandbox/copy.go for why.
func goDependencyHydrationCommand(cwd string) domain.CommandSpec {
	return domain.CommandSpec{
		Argv:              []string{"go", "mod", "download"},
		Cwd:               cwd,
		TimeoutSeconds:    goDependencyHydrationTimeoutSeconds,
		Network:           true,
		ExpectedExitCodes: []int{0},
	}
}

// isGoDependencyHydration recognizes the injected hydration command itself,
// so injectGoDependencyHydration never double-inserts it.
func isGoDependencyHydration(command domain.CommandSpec) bool {
	return len(command.Argv) >= 3 &&
		strings.ToLower(filepath.Base(command.Argv[0])) == "go" &&
		strings.ToLower(command.Argv[1]) == "mod" &&
		strings.ToLower(command.Argv[2]) == "download"
}

// hasGoDependencyHydration reports whether a plan already carries a
// network-approved hydration operation.
func hasGoDependencyHydration(plan *domain.ExecutionPlan) bool {
	if plan == nil {
		return false
	}
	for _, op := range plan.Operations {
		if op.Type == "command" && op.Command.Network && isGoDependencyHydration(op.Command) {
			return true
		}
	}
	return false
}

// clearGoDependencyNetwork normalizes a plan that may have been persisted by
// the previous (flipping) implementation of this recovery, which set
// Network=true directly on go build/test/vet/list commands. Every eligible
// command must run offline; only the injected hydration step gets network.
func clearGoDependencyNetwork(plan *domain.ExecutionPlan) {
	if plan == nil {
		return
	}
	for index := range plan.Operations {
		command := &plan.Operations[index].Command
		if isGoDependencyCommand(*command) && !isGoDependencyHydration(*command) {
			command.Network = false
		}
	}
	for index := range plan.Verification {
		command := &plan.Verification[index]
		if isGoDependencyCommand(*command) && !isGoDependencyHydration(*command) {
			command.Network = false
		}
	}
}

// goDependencyHydrationSite returns where the hydration operation must be
// inserted: immediately before the first eligible Go operation, or after
// every operation (index == len(plan.Operations)) when only Verification is
// eligible — the common shape of apply_patch operations plus go build/test
// verification, where hydration must run only after any go.mod patch lands.
func goDependencyHydrationSite(plan *domain.ExecutionPlan) (index int, cwd string, ok bool) {
	for i, op := range plan.Operations {
		if op.Type == "command" && isGoDependencyCommand(op.Command) {
			return i, op.Command.Cwd, true
		}
	}
	for _, command := range plan.Verification {
		if isGoDependencyCommand(command) {
			return len(plan.Operations), command.Cwd, true
		}
	}
	return 0, "", false
}

// injectGoDependencyHydration adds a single network-approved `go mod
// download` operation to a failed Protected plan, instead of granting network
// to the plan's own build/test/vet/list commands. It reports whether it
// changed the plan; a false return with a false hasGoDependencyHydration
// means no eligible Go dependency command exists in the plan at all.
func injectGoDependencyHydration(plan *domain.ExecutionPlan) bool {
	if plan == nil || hasGoDependencyHydration(plan) {
		return false
	}
	index, cwd, ok := goDependencyHydrationSite(plan)
	if !ok {
		return false
	}
	// Defensive normalization: a plan persisted by the previous flipping
	// implementation must not keep network on build/test/vet/list.
	clearGoDependencyNetwork(plan)
	op := domain.Operation{Type: "command", Command: goDependencyHydrationCommand(cwd)}
	plan.Operations = append(plan.Operations, domain.Operation{})
	copy(plan.Operations[index+1:], plan.Operations[index:])
	plan.Operations[index] = op
	return true
}

func isGoDependencyCommand(command domain.CommandSpec) bool {
	if len(command.Argv) < 2 || strings.ToLower(filepath.Base(command.Argv[0])) != "go" {
		return false
	}
	switch strings.ToLower(command.Argv[1]) {
	case "build", "test", "vet", "list":
		return true
	default:
		return false
	}
}
