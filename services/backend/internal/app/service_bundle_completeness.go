package app

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"kernl.local/harness/backend/internal/domain"
)

// ErrUndeliverableImpactFile marks a change bundle that declares a file it
// neither writes nor can find. The plan promises a file that will exist
// nowhere, so the change is structurally incomplete before a single command
// runs.
//
// Production evidence, two independent chats:
//
//   - `plan_debug_protocol_v1_redaction_assertion_repair` declared 44 impact
//     files and delivered 40. The four it skipped — `domain/debug.go`,
//     `service_debug.go`, `prompt_debug.go` and the ADR — were the definitions
//     its own patch referenced, so verification failed with `undefined:
//     DebugRun` and `undefined: DebugEvidence`. The previous round's attempt
//     ledger had named those exact four files as a hard exclusion.
//   - `plan_req_20260912T203628_…_worker` declared 23 and delivered 22; the
//     missing `session/chat_agent_assignment.go` produced `undefined:
//     normalizeChatAgentWorkerID`.
//
// None of those five files existed in the repository before or after, so each
// was a promised new file that never arrived. Measured across every archived
// bundle, this signature had two detections and no false positives.
var ErrUndeliverableImpactFile = errors.New("change bundle declares impact files it neither writes nor can find")

// undeliverableImpactFiles returns the declared impact files that the patch set
// does not write and that do not exist in the project.
//
// The two conditions together are what make this safe. `impact_files` remains a
// forecast — over-declaring a file that already exists is ordinary planner
// imprecision and is deliberately tolerated. But declaring a path that neither
// exists nor is created states something that cannot become true, and no
// legitimate plan needs to. Anything the check cannot resolve is treated as
// deliverable, so a measurement failure never rejects a valid change.
func undeliverableImpactFiles(projectPath string, plan *domain.ExecutionPlan) []string {
	if plan == nil || len(plan.ImpactFiles) == 0 {
		return nil
	}
	written := make(map[string]bool)
	for _, path := range actualPatchFiles(plan) {
		written[path] = true
	}
	if len(written) == 0 {
		// A plan with no patch at all is a workflow/evidence round whose
		// impact_files forecast what a later change will touch. Nothing is
		// promised for delivery here.
		return nil
	}
	// An empty project path must fail open rather than resolve to the process
	// working directory, which would measure an unrelated tree.
	trimmed := strings.TrimSpace(projectPath)
	if trimmed == "" {
		return nil
	}
	root, err := filepath.Abs(trimmed)
	if err != nil {
		return nil
	}
	missing := make([]string, 0)
	for _, declared := range normalizedPaths(plan.ImpactFiles) {
		if written[declared] || projectFileExists(root, declared) {
			continue
		}
		missing = append(missing, declared)
	}
	return missing
}

// projectFileExists reports whether a declared path resolves to a real file
// inside the project. It fails open: a path it cannot resolve safely counts as
// existing, because rejecting a legitimate change is worse than missing a
// detection.
func projectFileExists(root, relative string) bool {
	cleaned := filepath.Clean(filepath.FromSlash(relative))
	if filepath.IsAbs(cleaned) || cleaned == "." || strings.HasPrefix(cleaned, "..") {
		return true
	}
	candidate := filepath.Join(root, cleaned)
	if !strings.HasPrefix(candidate, root+string(os.PathSeparator)) {
		return true
	}
	if _, err := os.Lstat(candidate); err == nil {
		return true
	} else if !errors.Is(err, os.ErrNotExist) {
		return true
	}
	return false
}

// rejectUndeliverableImpactFiles refuses an incomplete change bundle at
// ingestion, before Policy and before sandbox verification — the same seam and
// the same reasoning as the commit_message and submodule rules. Discovering the
// incompleteness later costs a full sandbox run plus an automatic repair round
// whose diagnostic is a compiler error about a symbol, which invites the
// planner to re-read source that was never at fault instead of shipping the
// file it already promised.
func (s *Service) rejectUndeliverableImpactFiles(sessionID, projectPath string, plan *domain.ExecutionPlan) error {
	missing := undeliverableImpactFiles(projectPath, plan)
	if len(missing) == 0 {
		return nil
	}
	s.bus.Publish(sessionID, "bundle.incomplete_impact_files", map[string]any{
		"plan_id": plan.PlanID, "request_id": plan.RequestID, "paths": missing,
	})
	return fmt.Errorf("%w: %s. Declare only files this change actually writes, or include them in the patch",
		ErrUndeliverableImpactFile, strings.Join(missing, ", "))
}
