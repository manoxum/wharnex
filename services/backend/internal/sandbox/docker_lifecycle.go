package sandbox

import (
	"errors"
	"os"
	"os/exec"
	"runtime"
)

var errDockerSocketActivation = errors.New("docker.socket is active while docker.service is stopped; Wharnex refuses to auto-start Docker because daemon startup can change host networking; start Docker explicitly, then retry")

func refuseDockerSocketActivation() error {
	if runtime.GOOS != "linux" || os.Getenv("DOCKER_HOST") != "" {
		return nil
	}
	if _, err := exec.LookPath("systemctl"); err != nil {
		return nil
	}
	return dockerSocketActivationPolicy(
		systemdUnitActive("docker.service"),
		systemdUnitActive("docker.socket"),
	)
}

func systemdUnitActive(unit string) bool {
	return exec.Command("systemctl", "is-active", "--quiet", unit).Run() == nil
}

func dockerSocketActivationPolicy(serviceActive, socketActive bool) error {
	if !serviceActive && socketActive {
		return errDockerSocketActivation
	}
	return nil
}
