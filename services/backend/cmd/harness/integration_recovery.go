package main

import (
	"context"
	"log"
	"time"

	"kernl.local/harness/backend/internal/app"
)

// Integration recovery waits out startup reconciliation, then sweeps on an
// interval: host state that makes a parked candidate integrable (an operator
// commit, another chat's integration, an engine upgrade) arrives at no
// predictable moment, and each proven host state is retried at most once.
const (
	integrationRecoveryStartupDelay = 45 * time.Second
	integrationRecoveryInterval     = 5 * time.Minute
	integrationRecoverySweepTimeout = 30 * time.Minute
)

// configureIntegrationRecovery wires app.Service.RecoverBlockedIntegrations
// as a background sweep and returns its stop function.
func configureIntegrationRecovery(service *app.Service) func() {
	stop := make(chan struct{})
	sweep := func() {
		ctx, cancel := context.WithTimeout(context.Background(), integrationRecoverySweepTimeout)
		defer cancel()
		if attempted := service.RecoverBlockedIntegrations(ctx); attempted > 0 {
			log.Printf("integration recovery resumed %d parked session(s)", attempted)
		}
	}
	go func() {
		select {
		case <-time.After(integrationRecoveryStartupDelay):
			sweep()
		case <-stop:
			return
		}
		ticker := time.NewTicker(integrationRecoveryInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				sweep()
			case <-stop:
				return
			}
		}
	}()
	return func() { close(stop) }
}
