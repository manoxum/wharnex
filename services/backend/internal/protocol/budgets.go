package protocol

import (
	"fmt"

	"kernl.local/harness/backend/internal/domain"
)

// Protocol budgets are the numeric limits Validate enforces. They are named
// constants (rather than literals inline in Validate) so the environment
// manifest can publish the exact values the validator applies: a planner that
// cannot see them writes plans that are rejected wholesale, which is precisely
// how two consecutive production requests were lost to a single out-of-range
// timeout_seconds.
const (
	// MinCommandTimeoutSeconds / MaxCommandTimeoutSeconds bound a single
	// argv command. The maximum is generous enough for a full race-enabled
	// test suite while still guaranteeing a stuck command is reaped.
	MinCommandTimeoutSeconds = 1
	MaxCommandTimeoutSeconds = 1800

	// DefaultCommandTimeoutSeconds is applied when a transport omits
	// timeout_seconds entirely.
	DefaultCommandTimeoutSeconds = 60

	MaxOperations           = 100
	MaxVerificationCommands = 50
	MaxCommandArgs          = 128
	MaxImpactFiles          = 256
	MaxReadFiles            = 256
	MaxBarrierFiles         = 64
	MaxPatchBytes           = 2 * 1024 * 1024

	// MaxCrossProjectUnits bounds how many other projects one response may
	// change. Each unit becomes a derived request with its own sandbox,
	// verification and host integration, so the real cost of raising this is
	// measured in project clones, not in JSON.
	MaxCrossProjectUnits = 8
)

// NormalizeCommandBudgets repairs the one transport mistake that is both
// common and unambiguously non-semantic: a command timeout that is missing,
// zero, negative, or above the accepted ceiling. It is deliberately narrow —
// it never invents argv, paths, exit codes, network flags or any other
// security-relevant field, and the normalized plan still passes Validate
// unchanged (see AGENTS.md, "Manual plan transport normalization").
//
// It returns one human-readable note per adjustment so the caller can record
// what was changed instead of silently reinterpreting the planner's intent.
// A zero/missing timeout takes the documented default; an over-ceiling
// timeout is clamped to the ceiling, which is the largest budget the runner
// would have honoured anyway.
func NormalizeCommandBudgets(plan *domain.ExecutionPlan) []string {
	if plan == nil {
		return nil
	}
	notes := make([]string, 0)
	for index := range plan.Operations {
		if note := normalizeTimeout(&plan.Operations[index].Command, fmt.Sprintf("operation %d", index)); note != "" {
			notes = append(notes, note)
		}
	}
	for index := range plan.Verification {
		if note := normalizeTimeout(&plan.Verification[index], fmt.Sprintf("verification %d", index)); note != "" {
			notes = append(notes, note)
		}
	}
	if len(notes) == 0 {
		return nil
	}
	return notes
}

func normalizeTimeout(command *domain.CommandSpec, label string) string {
	// An apply_patch placeholder carries no argv and is never executed, so
	// its timeout is meaningless; Validate still requires it to be in range.
	original := command.TimeoutSeconds
	switch {
	case original <= 0:
		command.TimeoutSeconds = DefaultCommandTimeoutSeconds
		return fmt.Sprintf("%s: timeout_seconds %d replaced with the default %d", label, original, DefaultCommandTimeoutSeconds)
	case original > MaxCommandTimeoutSeconds:
		command.TimeoutSeconds = MaxCommandTimeoutSeconds
		return fmt.Sprintf("%s: timeout_seconds %d clamped to the maximum %d", label, original, MaxCommandTimeoutSeconds)
	default:
		return ""
	}
}
