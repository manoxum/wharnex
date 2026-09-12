package app

import (
	"strings"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/sandbox"
)

// This file recognizes the one execution failure class the repair loop was
// provably unable to fix: the sandbox ran out of a machine resource.
//
// Production evidence (chat f71a84f7e635): `go test -race ./...` failed with
// "link: mapping output file failed: no space left on device". Wharnex
// reported it as an ordinary verification failure, spent a repair round asking
// the planner to fix source that was never broken, and the retry failed
// identically. Like the offline Go module cache before it, this is an
// infrastructure fault whose remedy is host-side, not a patch.

// resourceExhaustionEvidence is the specific command whose output proved the
// sandbox ran out of resources, so the operator sees what actually failed
// rather than a generic "verification failed" wall of test output.
type resourceExhaustionEvidence struct {
	Argv        []string
	Cwd         string
	ExitCode    int
	Diagnostic  string
	MissingTool bool
}

// detectResourceExhaustion scans a failed execution's commands for a machine
// resource fault. It inspects the recorded command results rather than the
// wrapped error string, because the marker can appear in a test runner's
// stdout while the error itself only reports a non-zero exit code.
func detectResourceExhaustion(result domain.ExecutionResult) (resourceExhaustionEvidence, bool) {
	for index := len(result.Commands) - 1; index >= 0; index-- {
		command := result.Commands[index]
		if command.Success {
			continue
		}
		diagnostic := commandResultDiagnostic(command)
		if !sandbox.IsResourceExhaustionDiagnostic(diagnostic) {
			continue
		}
		return resourceExhaustionEvidence{
			Argv:       append([]string(nil), command.Argv...),
			Cwd:        command.Cwd,
			ExitCode:   command.ExitCode,
			Diagnostic: truncateRepairText(diagnostic, 4000),
		}, true
	}
	return resourceExhaustionEvidence{}, false
}

// detectMissingExecutable finds a failed command whose executable is simply
// not installed in the runner image. Unlike resource exhaustion this IS
// repairable by the planner — but only when the failure is named as such, so
// the repair prompt asks for a different tool instead of re-reading the source.
// The environment manifest publishes the installed inventory precisely so this
// path stays unused.
func detectMissingExecutable(result domain.ExecutionResult) (resourceExhaustionEvidence, bool) {
	for index := len(result.Commands) - 1; index >= 0; index-- {
		command := result.Commands[index]
		if command.Success {
			continue
		}
		diagnostic := commandResultDiagnostic(command)
		if !sandbox.IsMissingExecutableDiagnostic(command.ExitCode, diagnostic) {
			continue
		}
		return resourceExhaustionEvidence{
			Argv:        append([]string(nil), command.Argv...),
			Cwd:         command.Cwd,
			ExitCode:    command.ExitCode,
			Diagnostic:  truncateRepairText(diagnostic, 2000),
			MissingTool: true,
		}, true
	}
	return resourceExhaustionEvidence{}, false
}

// executableName is the tool a missing-executable failure names, used for the
// operator-facing event and the repair prompt hint.
func (e resourceExhaustionEvidence) executableName() string {
	if len(e.Argv) == 0 {
		return ""
	}
	return strings.TrimSpace(e.Argv[0])
}

func (e resourceExhaustionEvidence) commandLine() string {
	return strings.Join(e.Argv, " ")
}
