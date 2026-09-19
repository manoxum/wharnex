package app

import (
	"log"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/audit"
	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/ids"
)

const executionErrorStageExecution = "execution"

func (s *Service) ExecutionErrors(sessionID string) ([]domain.ExecutionErrorRecord, error) {
	if _, err := s.store.Get(sessionID); err != nil {
		return nil, err
	}
	return s.store.ExecutionErrors(sessionID)
}

func (s *Service) recordExecutionFailure(sessionID string, result domain.ExecutionResult, cause error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		log.Printf("load session for execution error ledger %s: %v", sessionID, err)
		return
	}
	requestID := item.LastRequestID
	if item.Plan != nil && item.Plan.PlanID == result.PlanID {
		requestID = item.Plan.RequestID
	}
	rootRequestID := requestRootFor(item, requestID)
	logs, statusCode := executionErrorLogs(result)
	failureKind := classifyExecutionFailure(cause)
	now := time.Now().UTC()
	record := domain.ExecutionErrorRecord{
		ID: ids.New("err"), SessionID: sessionID, ChatID: item.ChatID,
		RootRequestID: rootRequestID, RequestID: requestID, PlanID: result.PlanID,
		Stage: executionErrorStageExecution, Error: audit.SanitizeText(cause.Error()),
		Cause: audit.SanitizeText(executionFailureCauseSummary(result, cause)), FailureKind: failureKind,
		StatusCode: statusCode, Logs: logs, Status: domain.ExecutionErrorStatusOpen,
		OccurredAt: now, UpdatedAt: now,
	}
	if err := s.store.RecordExecutionError(record); err != nil {
		log.Printf("record execution error for session %s: %v", sessionID, err)
		if s.bus != nil {
			s.bus.Publish(sessionID, "execution.error_ledger_degraded", map[string]any{"error": err.Error(), "plan_id": result.PlanID})
		}
		return
	}
	if s.bus != nil {
		s.bus.Publish(sessionID, "execution.error_recorded", map[string]any{
			"error_id": record.ID, "plan_id": record.PlanID, "request_id": requestID,
			"root_request_id": rootRequestID, "failure_kind": failureKind, "status_code": statusCode,
		})
	}
}

func (s *Service) resolveExecutionFailuresWithGPT(sessionID string, item domain.Session, plan domain.ExecutionPlan) {
	lineage, ok := item.RequestLineages[plan.RequestID]
	if !ok || !gptCorrectionLineage(lineage.Kind) {
		return
	}
	rootRequestID := requestRootFor(item, plan.RequestID)
	if strings.TrimSpace(rootRequestID) == "" {
		return
	}
	solution := domain.ExecutionErrorSolution{
		RequestID: plan.RequestID, PlanID: plan.PlanID,
		Summary: audit.SanitizeText(plan.Summary), CommitMessage: audit.SanitizeText(plan.CommitMessage),
	}
	count, err := s.store.ResolveExecutionErrors(sessionID, rootRequestID, solution)
	if err != nil {
		log.Printf("resolve execution error ledger for session %s: %v", sessionID, err)
		if s.bus != nil {
			s.bus.Publish(sessionID, "execution.error_resolution_degraded", map[string]any{"error": err.Error(), "plan_id": plan.PlanID})
		}
		return
	}
	if count > 0 && s.bus != nil {
		s.bus.Publish(sessionID, "execution.errors_resolved", map[string]any{
			"root_request_id": rootRequestID, "solution_request_id": plan.RequestID,
			"solution_plan_id": plan.PlanID, "resolved_count": count,
		})
	}
}

func gptCorrectionLineage(kind string) bool {
	switch kind {
	case requestKindRepair, requestKindRevertRestore, requestKindImprovement, requestKindConflict:
		return true
	default:
		return false
	}
}

func executionErrorLogs(result domain.ExecutionResult) ([]domain.ExecutionErrorLog, *int) {
	logs := make([]domain.ExecutionErrorLog, 0)
	var statusCode *int
	for _, command := range result.Commands {
		if command.Success {
			continue
		}
		exitCode := command.ExitCode
		if statusCode == nil {
			value := exitCode
			statusCode = &value
		}
		argv := make([]string, len(command.Argv))
		for index, value := range command.Argv {
			argv[index] = audit.SanitizeText(value)
		}
		logs = append(logs, domain.ExecutionErrorLog{
			Kind: "command", Argv: argv, Cwd: audit.SanitizeText(command.Cwd),
			ExitCode: &exitCode, Stdout: audit.SanitizeText(command.Stdout), Stderr: audit.SanitizeText(command.Stderr),
			DurationMS: command.DurationMS,
		})
	}
	for _, operation := range result.Interactive {
		if operation.Status != "failed" && strings.TrimSpace(operation.Error) == "" {
			continue
		}
		logs = append(logs, domain.ExecutionErrorLog{
			Kind: "interactive", OperationID: operation.OperationID, OperationType: operation.Type,
			Output: audit.SanitizeText(operation.Output), Error: audit.SanitizeText(operation.Error),
		})
	}
	return logs, statusCode
}
