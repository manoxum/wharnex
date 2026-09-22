package app

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/domain"
)

func TestFullWaivesOnlyBypassablePolicyApprovals(t *testing.T) {
	decision := &domain.PolicyDecision{
		Allowed: true, RequiresApproval: true, Risk: "high",
		ApprovalItems: []domain.ExecutionApproval{{Kind: "command", BypassInFull: true}},
	}
	if policyRequiresApprovalForMode(decision, domain.ExecutionModeFull) {
		t.Fatal("Full should waive command-policy approval items explicitly marked bypassable")
	}
	decision.ApprovalItems = append(decision.ApprovalItems, domain.ExecutionApproval{Kind: "sudo", RequiresSudoPassword: true})
	if !policyRequiresApprovalForMode(decision, domain.ExecutionModeFull) {
		t.Fatal("Full must not waive sudo approval")
	}
}

func TestPrepareAuthorizedSudoCommandRequiresEphemeralCredential(t *testing.T) {
	command := domain.CommandSpec{Argv: []string{"sudo", "systemctl", "restart", "demo.service"}, Cwd: ".", TimeoutSeconds: 30, ExpectedExitCodes: []int{0}}
	if _, err := prepareAuthorizedCommand(context.Background(), command, true); !errors.Is(err, ErrSudoCredentialRequired) {
		t.Fatalf("expected ErrSudoCredentialRequired, got %v", err)
	}
	prepared, err := prepareAuthorizedCommand(withSudoPassword(context.Background(), "temporary-secret"), command, true)
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(prepared.Argv, " "); got != "sudo -S -p  systemctl restart demo.service" {
		t.Fatalf("unexpected sudo argv: %q", got)
	}
	if string(prepared.Stdin) != "temporary-secret\n" {
		t.Fatalf("credential not prepared as stdin: %q", string(prepared.Stdin))
	}
	encoded, err := json.Marshal(prepared)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), "temporary-secret") {
		t.Fatalf("ephemeral credential leaked into JSON: %s", encoded)
	}
}

func TestPrepareAuthorizedSudoCommandRejectsProtectedExecution(t *testing.T) {
	command := domain.CommandSpec{Argv: []string{"sudo", "true"}, Cwd: ".", TimeoutSeconds: 30, ExpectedExitCodes: []int{0}}
	_, err := prepareAuthorizedCommand(withSudoPassword(context.Background(), "temporary-secret"), command, false)
	if err == nil || !strings.Contains(err.Error(), "host-direct") {
		t.Fatalf("Protected sudo should be rejected, got %v", err)
	}
}
