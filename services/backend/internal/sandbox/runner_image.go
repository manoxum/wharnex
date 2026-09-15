package sandbox

import (
	"context"
	"fmt"
	"os/exec"
	"strings"
)

// ensureLocalRunnerImage prevents Docker from treating the configured runner
// image as a registry image. The Protected runner is intentionally built by
// the operator (make build-runner), not pulled or built as a side effect of a
// plan, a terminal, or a normal application lifecycle command.
func ensureLocalRunnerImage(ctx context.Context, image string) error {
	image = strings.TrimSpace(image)
	if image == "" {
		return runnerImageUnavailableError(image)
	}
	if err := exec.CommandContext(ctx, "docker", "image", "inspect", image).Run(); err == nil {
		return nil
	}
	return runnerImageUnavailableError(image)
}

func runnerImageUnavailableError(image string) error {
	if image == "" {
		return fmt.Errorf("Protected runner image is not configured; set HARNESS_RUNNER_IMAGE to a locally built image, or run make build-runner for the default kernl-runner:local image")
	}
	return fmt.Errorf("Protected runner image %q is unavailable locally (or Docker cannot be reached); Wharnex will not pull runner images. Start Docker if needed, then run `make build-runner RUNNER_IMAGE=%q` from the Wharnex repository root and retry", image, image)
}
