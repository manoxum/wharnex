package sandbox

import (
	"errors"
	"testing"
)

func TestDockerSocketActivationPolicyRejectsStoppedServiceWithListeningSocket(t *testing.T) {
	err := dockerSocketActivationPolicy(false, true)
	if !errors.Is(err, errDockerSocketActivation) {
		t.Fatalf("expected socket-activation rejection, got %v", err)
	}
}

func TestDockerSocketActivationPolicyAllowsAlreadyRunningService(t *testing.T) {
	if err := dockerSocketActivationPolicy(true, true); err != nil {
		t.Fatalf("running Docker service should be allowed: %v", err)
	}
}

func TestDockerSocketActivationPolicyAllowsInactiveSocket(t *testing.T) {
	if err := dockerSocketActivationPolicy(false, false); err != nil {
		t.Fatalf("inactive Docker socket cannot socket-activate the daemon: %v", err)
	}
}
