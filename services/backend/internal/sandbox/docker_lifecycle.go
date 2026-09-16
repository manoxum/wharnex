package sandbox

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"runtime"
	"time"
)

var errDockerSocketActivation = errors.New("docker.socket is active while docker.service is stopped; Wharnex refuses to auto-start Docker because daemon startup can change host networking; start Docker explicitly, then retry")

func refuseDockerSocketActivation() error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return refuseDockerSocketActivationContext(ctx)
}

func refuseDockerSocketActivationContext(ctx context.Context) error {
	if runtime.GOOS != "linux" || os.Getenv("DOCKER_HOST") != "" {
		return nil
	}
	if _, err := exec.LookPath("systemctl"); err != nil {
		return nil
	}
	serviceActive, err := systemdUnitActiveContext(ctx, "docker.service")
	if err != nil {
		return err
	}
	socketActive, err := systemdUnitActiveContext(ctx, "docker.socket")
	if err != nil {
		return err
	}
	return dockerSocketActivationPolicy(serviceActive, socketActive)
}

func systemdUnitActiveContext(ctx context.Context, unit string) (bool, error) {
	err := exec.CommandContext(ctx, "systemctl", "is-active", "--quiet", unit).Run()
	if ctxErr := ctx.Err(); ctxErr != nil {
		return false, ctxErr
	}
	return err == nil, nil
}

func dockerSocketActivationPolicy(serviceActive, socketActive bool) error {
	if !serviceActive && socketActive {
		return errDockerSocketActivation
	}
	return nil
}
