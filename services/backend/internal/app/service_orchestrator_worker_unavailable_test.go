package app

import (
	"errors"
	"testing"

	"kernl.local/harness/backend/internal/orchestrator"
)

func TestOrchestratorStoreFailureIsUnavailabilityNotATaskRefusal(t *testing.T) {
	err := orchestratorStoreUnavailable(errors.New(`get orchestrator task: ERROR: column "id" does not exist`))
	if !errors.Is(err, ErrOrchestratorStoreUnavailable) {
		t.Fatalf("a store failure must be typed as unavailability: %v", err)
	}
	if errors.Is(orchestrator.ErrNotFound, ErrOrchestratorStoreUnavailable) {
		t.Fatal("a missing task is a refusal about the task, not backend unavailability")
	}
}
