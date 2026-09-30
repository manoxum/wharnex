package protocol

import (
	"errors"
	"fmt"
	"kernl.local/harness/backend/internal/domain"
	"strings"
)

// ValidateWorkflowPlan constrains an iterative evidence step. Interactive v1
// remains argv-only/read-only; interactive v2 admits typed capabilities whose
// authority is validated against the explicit capability/scope declaration.
func ValidateWorkflowPlan(plan domain.ExecutionPlan) error {
	if err := Validate(plan); err != nil {
		return err
	}
	if plan.VersionIncrement != nil {
		return errors.New("workflow plan must not contain version_increment")
	}
	if plan.Status != "ready" {
		return errors.New("workflow plan must be ready")
	}
	isV2 := plan.Debug != nil && plan.Debug.Protocol == domain.InteractiveProtocolV2
	if !isV2 {
		if plan.Risk == "high" {
			return errors.New("workflow plan risk must be low or medium")
		}
		if plan.RequiresApproval {
			return errors.New("workflow plan cannot require host approval")
		}
	}
	engineQuery := plan.Debug != nil && strings.TrimSpace(plan.Debug.Query) != ""
	if len(plan.Operations) == 0 && !engineQuery {
		return errors.New("workflow plan requires at least one operation")
	}
	if len(plan.Operations) > 16 {
		return errors.New("workflow plan exceeds 16 operations")
	}
	for i, op := range plan.Operations {
		if op.Type == "apply_patch" {
			return fmt.Errorf("workflow operation %d cannot apply patches", i)
		}
		if !isV2 && op.Type != "command" {
			return fmt.Errorf("workflow operation %d must be command", i)
		}
		if !isV2 && op.Command.Network {
			return fmt.Errorf("workflow operation %d cannot request network access", i)
		}
	}
	if isV2 && len(plan.Verification) != 0 {
		return errors.New("interactive v2 uses typed operations as evidence and does not accept verification commands")
	}
	for i, command := range plan.Verification {
		if command.Network {
			return fmt.Errorf("workflow verification %d cannot request network access", i)
		}
	}
	if plan.Debug != nil {
		if err := ValidateDebugPlan(plan); err != nil {
			return err
		}
	}
	return nil
}

func ValidateDebugPlan(plan domain.ExecutionPlan) error {
	debug := plan.Debug
	if debug == nil {
		return errors.New("debug protocol is required")
	}
	if debug.Protocol != domain.DebugProtocolV1 && debug.Protocol != domain.InteractiveProtocolV1 && debug.Protocol != domain.InteractiveProtocolV2 {
		return fmt.Errorf("unsupported interactive protocol %q", debug.Protocol)
	}
	if debug.Target != "sandbox" && debug.Target != "host" {
		return errors.New("debug target must be sandbox or host")
	}
	access := debug.EffectiveAccess()
	if access != domain.DebugAccessObserve && access != domain.DebugAccessModify {
		return fmt.Errorf("unsupported debug access %q", debug.Access)
	}
	if debug.Protocol != domain.InteractiveProtocolV2 {
		if access == domain.DebugAccessModify {
			return errors.New("host-modifying debug workflows are retired; use harness.interactive/v2")
		}
		if len(debug.Capabilities) != 0 {
			return errors.New("interactive capabilities require harness.interactive/v2")
		}
	} else {
		if access == domain.DebugAccessModify && debug.Target != "host" {
			return errors.New("interactive v2 modify access requires host target")
		}
		if len(debug.Capabilities) == 0 {
			return errors.New("interactive v2 requires capabilities")
		}
		declared := make(map[string]bool, len(debug.Capabilities))
		for _, capability := range debug.Capabilities {
			if !domain.ValidInteractiveCapability(capability) {
				return fmt.Errorf("unsupported interactive capability %q", capability)
			}
			if declared[capability] {
				return fmt.Errorf("duplicate interactive capability %q", capability)
			}
			declared[capability] = true
		}
		for i, op := range plan.Operations {
			capability := interactiveOperationCapability(op.Type)
			if capability == "" || !declared[capability] {
				return fmt.Errorf("workflow operation %d requires undeclared capability %q", i, capability)
			}
			if err := validateInteractiveAccessAndScope(debug, op); err != nil {
				return fmt.Errorf("workflow operation %d: %w", i, err)
			}
		}
		if access == domain.DebugAccessModify && (!plan.RequiresApproval || plan.Risk != "high") {
			return errors.New("interactive v2 modify requires risk=high and requires_approval=true")
		}
	}
	if debug.Query != "" {
		if debug.Query != domain.DebugQueryProjectExecutionSummary {
			return fmt.Errorf("unsupported debug query %q", debug.Query)
		}
		if debug.Target != "host" {
			return errors.New("project execution summary debug query requires host target")
		}
		if access != domain.DebugAccessObserve {
			return errors.New("debug queries are observe-only")
		}
	}
	if rationale := strings.TrimSpace(debug.Rationale); rationale == "" || len(rationale) > 4096 {
		return errors.New("debug rationale must be 1..4096 bytes")
	}
	if debug.Protocol != domain.InteractiveProtocolV2 && debug.Target == "host" {
		for i, op := range plan.Operations {
			if err := validateHostDebugCommand(op.Command); err != nil {
				return fmt.Errorf("debug host operation %d: %w", i, err)
			}
		}
		for i, command := range plan.Verification {
			if err := validateHostDebugCommand(command); err != nil {
				return fmt.Errorf("debug host verification %d: %w", i, err)
			}
		}
	}
	return nil
}

func interactiveOperationCapability(operationType string) string {
	switch operationType {
	case "command", "shell", "sql", "logs", "filesystem", "process", "network", "container", "service":
		return operationType
	default:
		return ""
	}
}
