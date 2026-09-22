package app

import (
	"context"
	"errors"
	"path/filepath"
	"strings"

	"kernl.local/harness/backend/internal/domain"
)

var ErrSudoCredentialRequired = errors.New("sudo password required")

type sudoCredentialContextKey struct{}

func withSudoPassword(ctx context.Context, password string) context.Context {
	if password == "" {
		return ctx
	}
	return context.WithValue(ctx, sudoCredentialContextKey{}, []byte(password))
}

func sudoPasswordFromContext(ctx context.Context) []byte {
	value, _ := ctx.Value(sudoCredentialContextKey{}).([]byte)
	return value
}

func policyRequiresSudoCredential(decision *domain.PolicyDecision) bool {
	if decision == nil {
		return false
	}
	for _, item := range decision.ApprovalItems {
		if item.RequiresSudoPassword {
			return true
		}
	}
	return false
}

func policyRequiresApprovalForMode(decision *domain.PolicyDecision, mode domain.ExecutionMode) bool {
	if decision == nil || !decision.RequiresApproval {
		return false
	}
	if mode != domain.ExecutionModeFull {
		return true
	}
	if len(decision.ApprovalItems) == 0 {
		// Legacy/unknown approvals fail safe rather than being silently waived.
		return true
	}
	for _, item := range decision.ApprovalItems {
		if !item.BypassInFull {
			return true
		}
	}
	return false
}

func prepareAuthorizedCommand(ctx context.Context, command domain.CommandSpec, hostDirect bool) (domain.CommandSpec, error) {
	if len(command.Argv) == 0 || strings.ToLower(filepath.Base(command.Argv[0])) != "sudo" {
		return command, nil
	}
	if !hostDirect {
		return domain.CommandSpec{}, errors.New("sudo commands require Unprotected or Full host-direct execution mode")
	}
	password := sudoPasswordFromContext(ctx)
	if len(password) == 0 {
		return domain.CommandSpec{}, ErrSudoCredentialRequired
	}
	prepared := command
	prepared.Argv = append([]string{"sudo", "-S", "-p", ""}, command.Argv[1:]...)
	prepared.Stdin = append([]byte(nil), password...)
	prepared.Stdin = append(prepared.Stdin, '\n')
	return prepared, nil
}
