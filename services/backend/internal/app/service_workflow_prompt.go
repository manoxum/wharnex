package app

import (
	"fmt"
	"strings"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/planner"
	"kernl.local/harness/backend/internal/protocol"
)

func turnCarriesExecutionPlan(kind domain.TurnKind) bool {
	return kind == domain.TurnKindChange || kind == domain.TurnKindWorkflow
}

func normalizePlannerResult(requestID string, result *planner.Result) error {
	normalizePlanCollections(result.Plan)
	if result.Turn == nil && result.Plan != nil {
		result.Turn = &domain.AgentTurn{Protocol: domain.TurnProtocolV1, RequestID: requestID, Kind: domain.TurnKindChange, Message: result.Plan.Summary, Outcome: &domain.TurnOutcome{Status: domain.TurnOutcomeCompleted}}
	}
	if result.Turn == nil {
		return nil
	}
	if result.Turn.RequestID != requestID {
		return fmt.Errorf("turn request_id mismatch: expected %s", requestID)
	}
	if err := protocol.ValidateTurn(*result.Turn); err != nil {
		return err
	}
	if result.Turn.Outcome.Status != domain.TurnOutcomeCompleted {
		if result.Plan != nil {
			return fmt.Errorf("non-completed turn outcome cannot contain an execution plan")
		}
		return nil
	}
	if turnCarriesExecutionPlan(result.Turn.Kind) && result.Plan == nil {
		return fmt.Errorf("%s turn requires an execution plan", result.Turn.Kind)
	}
	if !turnCarriesExecutionPlan(result.Turn.Kind) && result.Plan != nil {
		return fmt.Errorf("%s turn cannot contain an execution plan", result.Turn.Kind)
	}
	if result.Plan == nil {
		return nil
	}
	if result.Plan.RequestID != requestID {
		return fmt.Errorf("planner request_id mismatch: expected %s", requestID)
	}
	if result.Turn.Kind == domain.TurnKindWorkflow {
		return protocol.ValidateWorkflowPlan(*result.Plan)
	}
	return protocol.Validate(*result.Plan)
}

func buildWorkflowObservationMessage(result domain.ExecutionResult, round int) string {
	var out strings.Builder
	fmt.Fprintf(&out, "LOCAL WORKFLOW OBSERVATIONS — round %d of %d\n\n", round, maxWorkflowRounds)
	out.WriteString("Wharness executed the previous workflow step only inside a disposable Protected sandbox. Nothing from this workflow step was applied to the host project. Treat the following as execution evidence for the ORIGINAL user request in this same conversation.\n\n")
	fmt.Fprintf(&out, "PREVIOUS WORKFLOW PLAN: %s\nSUCCESS: %t\n", result.PlanID, result.Success)
	if result.Error != "" {
		fmt.Fprintf(&out, "ERROR: %s\n", truncateRepairText(result.Error, 6000))
	}
	for index, command := range result.Commands {
		fmt.Fprintf(&out, "\n[%d] argv=%q cwd=%q exit=%d success=%t\nSTDOUT:\n%s\nSTDERR:\n%s\n", index+1, command.Argv, command.Cwd, command.ExitCode, command.Success, truncateRepairText(command.Stdout, 6000), truncateRepairText(command.Stderr, 6000))
	}
	out.WriteString("\nNEXT DECISION:\n- If the evidence is sufficient, return a terminal answer or investigation with the complete useful conclusion.\n- If the original user explicitly requested mutation and the evidence is sufficient, return change with the final execution plan.\n- If another local probe is truly necessary, return workflow with a materially different targeted command plan.\n- Do not turn an ASK/advice request into a change.\n")
	if round >= maxWorkflowRounds {
		out.WriteString("\nFINAL WORKFLOW ROUND: you MUST return a terminal answer, investigation, clarification, change, or blocked result now. Do NOT return workflow again.\n")
	}
	return out.String()
}
