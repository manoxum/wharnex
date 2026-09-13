package app

import (
	"strings"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/sandbox"
)

// Post-merge verification re-runs the plan's own gates against the real merged
// host tree. Those gates already passed in the Protected runner image, which
// carries the project build toolchain; the host re-run happens in Wharnex's own
// control container, whose inventory is deliberately narrower. When that
// container cannot run a gate AT ALL, the gate returns no verdict about the
// merge — and treating "no verdict" as "failed" is what reverted a verified
// candidate and spent a repair round on source that was never implicated.
//
// Production evidence: `go test -race ./...` passed in the runner and failed
// post-merge in 5 ms with "go: -race requires cgo; enable cgo by setting
// CGO_ENABLED=1". No patch can add a C compiler to the container Wharnex
// itself runs in.
//
// This is the infrastructure-fault rule of the execution environment
// disclosure invariant applied to the host verification phase: such a fault
// MUST NOT consume an automatic repair round and MUST NOT discard a verified
// executable payload. The gate is recorded as unverified on host, loudly, and
// integration continues on the Protected verdict it already has.

// unsupportedGateReason is the closed set of reasons the host verification
// environment can be proven unable to run a gate. It is a Wharnex measurement
// of its own container, never planner-supplied text.
const (
	unsupportedGateMissingExecutable = "missing_executable"
	unsupportedGateToolchain         = "toolchain_capability_unavailable"
)

// unsupportedHostGate is one verification command the host environment could
// not run, kept so the operator is told exactly which corroboration the Apply
// went without.
type unsupportedHostGate struct {
	Argv       []string
	Cwd        string
	ExitCode   int
	Reason     string
	Executable string
	Diagnostic string
}

// classifyUnsupportedHostGate decides whether a failed post-merge command
// failed because of the environment rather than the merged content. It reads
// only the recorded command result, exactly like detectResourceExhaustion:
// the marker usually reaches us as the driver's own stderr while the error
// carries nothing but a non-zero exit code.
//
// It is deliberately conservative. Anything it does not positively recognize
// stays an ordinary verification failure, because misreading a real regression
// as an environment gap would let broken code onto the host.
func classifyUnsupportedHostGate(command domain.CommandSpec, result domain.CommandResult) (unsupportedHostGate, bool) {
	diagnostic := commandResultDiagnostic(result)
	gate := unsupportedHostGate{
		Argv:       append([]string(nil), command.Argv...),
		Cwd:        command.Cwd,
		ExitCode:   result.ExitCode,
		Diagnostic: truncateRepairText(diagnostic, 2000),
	}
	if len(command.Argv) > 0 {
		gate.Executable = strings.TrimSpace(command.Argv[0])
	}
	switch {
	case sandbox.IsMissingExecutableDiagnostic(result.ExitCode, diagnostic):
		gate.Reason = unsupportedGateMissingExecutable
	case sandbox.IsUnsupportedToolchainDiagnostic(diagnostic):
		gate.Reason = unsupportedGateToolchain
	default:
		return unsupportedHostGate{}, false
	}
	return gate, true
}

// event renders the gate for the operator-facing event stream. The diagnostic
// is included because the whole point of the classification is that the
// operator, not the planner, decides what to do about it.
func (g unsupportedHostGate) event(planID string) map[string]any {
	return map[string]any{
		"plan_id": planID, "argv": g.Argv, "cwd": g.Cwd, "target": "host",
		"exit_code": g.ExitCode, "reason": g.Reason,
		"executable": g.Executable, "diagnostic": g.Diagnostic,
	}
}

func (g unsupportedHostGate) commandLine() string { return strings.Join(g.Argv, " ") }

// unsupportedHostGateSummary names the gates an Apply went ahead without, for
// the terminal `host.applied` event. Being told which corroboration is missing
// is the operator's compensation for not being told the Apply failed.
func unsupportedHostGateSummary(gates []unsupportedHostGate) []map[string]any {
	if len(gates) == 0 {
		return nil
	}
	summary := make([]map[string]any, 0, len(gates))
	for _, gate := range gates {
		summary = append(summary, map[string]any{
			"argv": gate.commandLine(), "cwd": gate.Cwd, "reason": gate.Reason,
		})
	}
	return summary
}
