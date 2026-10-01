package protocol

import (
	"errors"
	"fmt"
	"kernl.local/harness/backend/internal/crossproject"
	"kernl.local/harness/backend/internal/domain"
	"strings"
)

// validateCrossProjectUnits checks the structure of work aimed at other
// projects. It is deliberately the same validation the primary plan gets: a
// change to another project is a whole change, and there is no reason it should
// be held to a weaker standard because it arrived inside somebody else's plan.
//
// What it does not do is decide authority. Whether a named project may be
// written at all is answered from the request's own grant at ingestion, with
// the session in hand; this function only sees the plan.
func validateAcquisitionStrategies(strategies []domain.PlanAcquisitionStrategy, hostMutation bool) error {
	if len(strategies) > 8 {
		return errors.New("exceeds 8 strategies")
	}
	for i, strategy := range strategies {
		if strings.TrimSpace(strategy.Reason) == "" {
			return fmt.Errorf("strategy %d requires reason", i)
		}
		switch strategy.Method {
		case "preinstalled", "project_cache", "lockfile_install", "corepack", "package_manager", "runner_image", "operator":
		default:
			return fmt.Errorf("strategy %d has invalid method %q", i, strategy.Method)
		}
		if hostMutation && strategy.Automatic {
			return fmt.Errorf("strategy %d cannot be automatic for host install/update/configure", i)
		}
	}
	return nil
}

func validateCrossProjectUnits(units []domain.CrossProjectUnit) error {
	if len(units) > MaxCrossProjectUnits {
		return fmt.Errorf("cross_project exceeds %d projects", MaxCrossProjectUnits)
	}
	for i, unit := range units {
		if !crossproject.ValidName(unit.Project) {
			return fmt.Errorf("cross_project %d: project must be a reference name from the request's @ref: grant, got %q", i, unit.Project)
		}
		// A unit with nothing to do is a declaration of authority over another
		// project with no change behind it. It is refused rather than ignored,
		// because silently dropping it would leave the response claiming a
		// change that never happened.
		if len(unit.Operations) == 0 {
			return fmt.Errorf("cross_project %d: project %q declares no operations", i, unit.Project)
		}
		if len(unit.Operations) > MaxOperations {
			return fmt.Errorf("cross_project %d: too many operations", i)
		}
		if len(unit.Verification) > MaxVerificationCommands {
			return fmt.Errorf("cross_project %d: too many verification commands", i)
		}
		// The message becomes that project's own permanent Git history, under
		// the same contract as any other commit Wharnex makes there.
		if err := ValidateCommitMessage(unit.CommitMessage); err != nil {
			return fmt.Errorf("cross_project %d: %w", i, err)
		}
		if err := validateOperations(unit.Operations); err != nil {
			return fmt.Errorf("cross_project %d: %w", i, err)
		}
		for j, command := range unit.Verification {
			if err := ValidateCommand(command); err != nil {
				return fmt.Errorf("cross_project %d: verification %d: %w", i, j, err)
			}
		}
	}
	return nil
}

func validateOperations(operations []domain.Operation) error {
	for i, op := range operations {
		switch op.Type {
		case "apply_patch":
			if len(op.Command.Argv) != 0 {
				return fmt.Errorf("operation %d: apply_patch command placeholder must have empty argv", i)
			}
			if strings.TrimSpace(op.Patch) == "" {
				return fmt.Errorf("operation %d has empty patch", i)
			}
			if err := ValidatePatch(op.Patch); err != nil {
				return fmt.Errorf("operation %d: %w", i, err)
			}
		case "command":
			if strings.TrimSpace(op.Patch) != "" {
				return fmt.Errorf("operation %d: command operation must have empty patch", i)
			}
			if err := ValidateCommand(op.Command); err != nil {
				return fmt.Errorf("operation %d: %w", i, err)
			}
		case "shell":
			if err := validateInteractiveShell(op.Shell); err != nil {
				return fmt.Errorf("operation %d: %w", i, err)
			}
		case "sql":
			if err := validateInteractiveSQL(op.SQL); err != nil {
				return fmt.Errorf("operation %d: %w", i, err)
			}
		case "logs":
			if err := validateInteractiveLogs(op.Logs); err != nil {
				return fmt.Errorf("operation %d: %w", i, err)
			}
		case "filesystem":
			if err := validateInteractiveFilesystem(op.Filesystem); err != nil {
				return fmt.Errorf("operation %d: %w", i, err)
			}
		case "process":
			if err := validateInteractiveProcess(op.Process); err != nil {
				return fmt.Errorf("operation %d: %w", i, err)
			}
		case "network":
			if err := validateInteractiveNetwork(op.Network); err != nil {
				return fmt.Errorf("operation %d: %w", i, err)
			}
		case "container":
			if err := validateInteractiveContainer(op.Container); err != nil {
				return fmt.Errorf("operation %d: %w", i, err)
			}
		case "service":
			if err := validateInteractiveService(op.Service); err != nil {
				return fmt.Errorf("operation %d: %w", i, err)
			}
		default:
			return fmt.Errorf("operation %d has unsupported type %q", i, op.Type)
		}
	}
	return nil
}
