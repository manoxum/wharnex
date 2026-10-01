package protocol

import (
	"errors"
	"fmt"
	"kernl.local/harness/backend/internal/domain"
	"strings"
)

func Validate(plan domain.ExecutionPlan) error {
	if len(plan.Operations) > MaxOperations {
		return errors.New("too many operations")
	}
	if len(plan.Verification) > MaxVerificationCommands {
		return errors.New("too many verification commands")
	}
	if plan.Protocol != domain.ProtocolV1 && plan.Protocol != domain.ProtocolV2 {
		return fmt.Errorf("unsupported protocol %q", plan.Protocol)
	}
	if plan.PlanID == "" || plan.RequestID == "" {
		return errors.New("plan_id and request_id are required")
	}
	if plan.Status != "ready" && plan.Status != "blocked" {
		return errors.New("status must be ready or blocked")
	}
	if plan.Risk != "low" && plan.Risk != "medium" && plan.Risk != "high" {
		return errors.New("invalid risk")
	}
	if err := validatePlanPresentation(plan); err != nil {
		return err
	}
	if plan.VersionIncrement != nil {
		if err := ValidateVersionIncrement(*plan.VersionIncrement); err != nil {
			return err
		}
	}
	if plan.Status == "blocked" && (len(plan.Operations) != 0 || len(plan.Verification) != 0) {
		return errors.New("blocked plan cannot contain operations or verification")
	}
	if baseline := strings.TrimSpace(plan.BaseContextSHA256); baseline != "" {
		if len(baseline) != 64 {
			return errors.New("base_context_sha256 must be a 64-character lowercase SHA-256")
		}
		for _, value := range baseline {
			if (value < '0' || value > '9') && (value < 'a' || value > 'f') {
				return errors.New("base_context_sha256 must be lowercase hexadecimal")
			}
		}
	}
	if len(plan.ImpactFiles) > MaxImpactFiles {
		return fmt.Errorf("impact_files exceeds %d paths", MaxImpactFiles)
	}
	for i, path := range plan.ImpactFiles {
		if err := validateDeclaredPath(path); err != nil {
			return fmt.Errorf("impact_files %d: %w", i, err)
		}
	}
	if len(plan.ReadFiles) > MaxReadFiles {
		return fmt.Errorf("read_files exceeds %d paths", MaxReadFiles)
	}
	for i, path := range plan.ReadFiles {
		if err := validateDeclaredPath(path); err != nil {
			return fmt.Errorf("read_files %d: %w", i, err)
		}
	}
	if len(plan.BarrierFiles) > MaxBarrierFiles {
		return fmt.Errorf("barrier_files exceeds %d paths", MaxBarrierFiles)
	}
	for i, path := range plan.BarrierFiles {
		if err := validateDeclaredPath(path); err != nil {
			return fmt.Errorf("barrier_files %d: %w", i, err)
		}
	}
	if err := validateOperations(plan.Operations); err != nil {
		return err
	}
	for i, command := range plan.Verification {
		if err := ValidateCommand(command); err != nil {
			return fmt.Errorf("verification %d: %w", i, err)
		}
	}
	return validateCrossProjectUnits(plan.CrossProject)
}

func validatePlanPresentation(plan domain.ExecutionPlan) error {
	if len(plan.Document) > 256<<10 {
		return errors.New("document exceeds 256 KiB limit")
	}
	if len(plan.Dependencies) > 128 {
		return errors.New("dependencies exceeds 128 entries")
	}
	for i, dependency := range plan.Dependencies {
		if strings.TrimSpace(dependency.Scope) == "" || strings.TrimSpace(dependency.Manager) == "" || strings.TrimSpace(dependency.Name) == "" || strings.TrimSpace(dependency.Reason) == "" {
			return fmt.Errorf("dependencies %d requires scope, manager, name and reason", i)
		}
		switch dependency.Action {
		case "install", "update", "remove", "use":
		default:
			return fmt.Errorf("dependencies %d has invalid action %q", i, dependency.Action)
		}
		if err := validateAcquisitionStrategies(dependency.Acquisition, false); err != nil {
			return fmt.Errorf("dependencies %d acquisition: %w", i, err)
		}
	}
	if len(plan.SystemTools) > 64 {
		return errors.New("system_tools exceeds 64 entries")
	}
	for i, tool := range plan.SystemTools {
		if tool.Target != "sandbox" && tool.Target != "host" {
			return fmt.Errorf("system_tools %d target must be sandbox or host", i)
		}
		if strings.TrimSpace(tool.Name) == "" || strings.TrimSpace(tool.Reason) == "" {
			return fmt.Errorf("system_tools %d requires name and reason", i)
		}
		switch tool.Action {
		case "install", "update", "configure", "use":
		default:
			return fmt.Errorf("system_tools %d has invalid action %q", i, tool.Action)
		}
		switch tool.Lifetime {
		case "", domain.ToolLifetimeTemporary, domain.ToolLifetimePersistent:
		default:
			return fmt.Errorf("system_tools %d has invalid lifetime %q", i, tool.Lifetime)
		}
		if err := validateAcquisitionStrategies(tool.Acquisition, tool.Target == "host" && tool.Action != "use"); err != nil {
			return fmt.Errorf("system_tools %d acquisition: %w", i, err)
		}
	}
	if approved := plan.ApprovedChatPlan; approved != nil {
		if approved.Protocol != "harness.chat-plan/v1" || strings.TrimSpace(approved.RequestID) == "" || len(approved.SHA256) != 64 || strings.TrimSpace(approved.Document) == "" {
			return errors.New("approved_chat_plan requires protocol, request_id, sha256 and document")
		}
		if len(approved.Document) > 256<<10 {
			return errors.New("approved_chat_plan document exceeds 256 KiB limit")
		}
		for _, value := range approved.SHA256 {
			if (value < '0' || value > '9') && (value < 'a' || value > 'f') {
				return errors.New("approved_chat_plan sha256 must be lowercase hexadecimal")
			}
		}
	}
	return nil
}
