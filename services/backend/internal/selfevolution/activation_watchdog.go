package selfevolution

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// ActivationAbandonAfter bounds how long an activation may sit in
// restart_scheduled/restarting without its detached supervisor reporting an
// outcome. A healthy activation reports within a couple of minutes; a stack
// rollback that rebuilds images still reports long before this.
const ActivationAbandonAfter = 15 * time.Minute

// SupervisorProbe reports whether the detached restart supervisor of a
// transaction is still running. known=false means liveness cannot be measured
// (local mode, Docker unavailable), and the age bound alone decides.
type SupervisorProbe func(transaction string) (running, known bool)

// ReconcileAbandonedActivation turns an activation whose supervisor vanished
// into restart_failed, the extendable phase the operator can retry from.
//
// The supervisor is the only writer of restarted/rolled_back_runtime. When it
// dies mid-activation — killed with the components it was replacing, or its
// container removed — nothing else ever moves the status, and restarting is a
// held phase: every later Apply refused with ErrBusy while the chat showed no
// failure and offered no action. Measured on 2026-09-25, one such transaction
// held the lock for almost six hours. A supervisor that is still running is
// real work and is never preempted.
func (m *Manager) ReconcileAbandonedActivation(now time.Time, probe SupervisorProbe) (Status, bool, error) {
	if !m.Enabled() {
		return Status{}, false, nil
	}
	status, err := m.LastStatus()
	if err != nil || (status.Phase != "restart_scheduled" && status.Phase != "restarting") {
		return status, false, nil
	}
	updated, err := time.Parse(time.RFC3339, status.UpdatedAt)
	if err != nil || now.Sub(updated) < ActivationAbandonAfter {
		return status, false, nil
	}
	if probe != nil {
		if running, known := probe(status.Transaction); known && running {
			return status, false, nil
		}
	}
	abandoned := status
	abandoned.Phase = "restart_failed"
	abandoned.Detail = fmt.Sprintf("o supervisor de ativação deixou de responder na fase %s desde %s sem reportar resultado; repita a ativação do lote pendente", status.Phase, status.UpdatedAt)
	m.logRecovery(fmt.Sprintf("activation_abandoned transaction=%s phase=%s plan=%s since=%s", sanitizeLabel(status.Transaction), sanitizeLabel(status.Phase), sanitizeLabel(status.PlanID), sanitizeLabel(status.UpdatedAt)))
	// The supervisor would have released the stage lock on restart_failed; the
	// batch lock stays, because restart_failed is the pending batch itself.
	_ = os.Remove(filepath.Join(m.root, ".harness", "self-evolution", "stage.lock"))
	if err := m.recordReleasedStatus(abandoned); err != nil {
		return status, false, err
	}
	return abandoned, true, nil
}

// SupervisorContainerName is the detached stack-mode supervisor of a
// transaction, named from the transaction id with or without its "txn-" prefix.
func SupervisorContainerName(transaction string) string {
	return "wharness-self-restart-" + sanitizeLabel(strings.TrimPrefix(strings.TrimSpace(transaction), "txn-"))
}

// DockerSupervisorProbe measures the stack-mode supervisor container. Outside
// stack mode, or when Docker cannot answer, liveness is reported as unknown.
func DockerSupervisorProbe(transaction string) (running, known bool) {
	if !strings.EqualFold(strings.TrimSpace(os.Getenv("WHARNESS_SERVICES_MODE")), "stack") {
		return false, false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	output, err := exec.CommandContext(ctx, "docker", "inspect", "-f", "{{.State.Running}}", SupervisorContainerName(transaction)).CombinedOutput()
	if err != nil {
		// The supervisor runs with --rm, so a finished or killed one is gone.
		if strings.Contains(strings.ToLower(string(output)), "no such") {
			return false, true
		}
		return false, false
	}
	return strings.TrimSpace(string(output)) == "true", true
}
