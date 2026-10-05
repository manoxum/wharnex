package repairprompt

import (
	"fmt"
	"strings"
)

const policyDeniedPrefix = "policy denied plan:"

// Command is one captured command of the failed execution.
type Command struct {
	Argv       []string
	ExitCode   int
	Success    bool
	Diagnostic string
}

// MissingExecutable names a command that exited 127 because its tool is absent.
type MissingExecutable struct {
	Name        string
	CommandLine string
}

// Input carries the facts the caller derived from the session and execution.
type Input struct {
	Manual        bool
	AttemptLabel  string // the effort/attempt label of the automatic round
	Effort        string
	AttemptsSpent int // autonomous attempts already spent, for manual requests
	Guidance      string
	Cause         string
	PlanID        string
	ExecutionMode string
	// HostDirect and PendingHostChanges select the workspace note.
	HostDirect           bool
	PendingHostChanges   bool
	PendingChangesPrompt string
	Commands             []Command
	MissingExecutable    *MissingExecutable
	CauseSummary         string
}

// Build renders the repair request for a failed or policy-rejected plan.
func Build(in Input) string {
	operatorGuidance := ""
	if clean := Truncate(in.Guidance, 4000); clean != "" {
		operatorGuidance = "\n\nOPTIONAL OPERATOR GUIDANCE:\n" + clean
	}
	if strings.HasPrefix(in.Cause, policyDeniedPrefix) {
		return policyRepair(in, operatorGuidance)
	}
	return executionRepair(in, operatorGuidance)
}

func heading(in Input, kind string) string {
	if in.Manual {
		return fmt.Sprintf("MANUAL GPT REPAIR REQUEST — operator requested after %d autonomous attempt(s)", in.AttemptsSpent)
	}
	return "AUTOMATIC " + kind + " — " + in.AttemptLabel + " · effort " + in.Effort
}

func policyRepair(in Input, operatorGuidance string) string {
	return fmt.Sprintf(`%s

The previous execution bundle was rejected by the Wharnex Policy Engine BEFORE any operation was executed.
Do not ask to relax, bypass, disable, or work around the Policy Engine. Produce a replacement plan for the SAME user intent using only operations and verification commands that are permitted by Wharnex policy.

BLOCKED PLAN ID: %s
POLICY REASONS:
%s

Use the current Wharnex project context as authoritative. Replace denied commands with safe project-local alternatives where possible. Return the corrected plan through the normal Wharnex file-first delivery contract.%s`, heading(in, "POLICY REPAIR REQUEST"), in.PlanID, Truncate(strings.TrimPrefix(in.Cause, policyDeniedPrefix), 12000), operatorGuidance)
}

func workspaceNote(in Input) string {
	note := "The failed Protected sandbox was discarded. Build the replacement patch against the original host project state represented by the Wharnex context."
	if in.PendingHostChanges {
		note = "Verified host-pending changes are retained. Build the correction incrementally against the candidate state produced by the pending patches listed below; Wharnex will replay and verify the complete chain in a fresh Protected sandbox before offering Apply again."
	}
	if in.HostDirect {
		note = "The failed host-direct execution may have partially changed the host. Wharnex refreshed the project context before creating this repair request; use that current context as authoritative."
	}
	// A missing executable reads like an ordinary failure in raw output, and
	// a planner handed only that output tends to re-read the source instead of
	// swapping the tool. Name the real cause so the repair targets it.
	if missing := in.MissingExecutable; missing != nil {
		note += fmt.Sprintf("\n\nROOT CAUSE — MISSING EXECUTABLE: %q is NOT installed in the Protected runner image, so %q exited 127 before doing any work. This is not a source defect: do not modify project code to chase it. Replace that command with one built from the executables listed in the request's LOCAL EXECUTION ENVIRONMENT tools inventory, or drop the check.", missing.Name, missing.CommandLine)
	}
	return note
}

func executionRepair(in Input, operatorGuidance string) string {
	failureText := Truncate(in.Cause, 12000)
	if strings.Contains(in.Cause, "self-evolution host build failed") {
		failureText = TruncateBuildOutput(in.Cause, 12000)
	}
	var diagnostics strings.Builder
	for index, command := range in.Commands {
		fmt.Fprintf(&diagnostics, "\n[%d] %s (exit %d, success=%t)\n%s\n", index+1, strings.Join(command.Argv, " "), command.ExitCode, command.Success, Truncate(command.Diagnostic, 6000))
	}
	return fmt.Sprintf(`%s

The previous execution plan failed and Wharnex captured the failure automatically.
Do not repeat the failed plan unchanged or submit a semantically equivalent strategy. Produce a corrected replacement plan for the SAME user intent, and make the new approach directly eliminate the named failure cause. If the cause cannot be fixed inside the current project/policy/environment, stop with a terminal blocked result using retryable=false and name the operator action required instead of starting another loop.
%s

FAILED PLAN ID: %s
EXECUTION MODE: %s
FAILURE:
%s

ROOT-CAUSE SUMMARY:
%s

CAPTURED COMMAND / VERIFICATION DIAGNOSTICS:%s

%s

KNOWLEDGE PROMOTION:
This repair response may be the last planner turn before verification and host Apply. If the failure exposed a reusable operational cause, fixture invariant, verification pattern, environment constraint, or repair strategy, update or consolidate the relevant knowledge/<id>.md record NOW in this response. Do not defer learning until after success because there is no post-Apply planner round. Prefer editing/merging an existing record on the same topic over creating a duplicate. Keep transient one-off details only in attempts/ledger.md.

Use the existing project context and the failure evidence above to identify the actual regression or execution problem. Return the corrected plan through the normal Wharnex file-first delivery contract.%s`, heading(in, "REPAIR REQUEST"), workspaceNote(in), in.PlanID, in.ExecutionMode, failureText, Truncate(in.CauseSummary, 4000), diagnostics.String(), in.PendingChangesPrompt, operatorGuidance)
}
