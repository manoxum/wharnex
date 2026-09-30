package selfevolution

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
)

// BuildOutputCallback receives incremental chunks of `make build-stage`
// output as they are produced. It exists so the host build — which can run
// for minutes (dependency hydration, npm ci, vite/tsc, go build) — can be
// shown live instead of appearing to hang until it finally succeeds or
// fails; see buildOutputWriter.
type BuildOutputCallback func(stream, text string)

// buildOutputWriter both accumulates the full output (limitedBuffer already
// bounds it) and forwards each chunk to onOutput as it is written, so the
// caller can publish it immediately rather than waiting for cmd.Run to
// return the complete text.
type buildOutputWriter struct {
	stream     string
	buffer     *limitedBuffer
	onOutput   BuildOutputCallback
	callbackMu *sync.Mutex
}

func (w *buildOutputWriter) Write(p []byte) (int, error) {
	n, err := w.buffer.Write(p)
	if w.onOutput != nil && len(p) > 0 {
		w.callbackMu.Lock()
		w.onOutput(w.stream, string(p))
		w.callbackMu.Unlock()
	}
	return n, err
}

func (m *Manager) BuildHost(ctx context.Context, tx Transaction, onOutput BuildOutputCallback) (string, error) {
	if tx.Root != m.root || tx.Dir == "" {
		return "", errors.New("invalid self-evolution transaction")
	}
	before, err := buildGuardSnapshot(m.root)
	if err != nil {
		return "", fmt.Errorf("capture pre-build source guard: %w", err)
	}
	cmd := exec.CommandContext(ctx, "make", "build-stage")
	cmd.Dir = m.root
	cmd.Env = append(os.Environ(), "WHARNESS_SELF_EVOLUTION=1")
	var output limitedBuffer
	var callbackMu sync.Mutex
	cmd.Stdout = &buildOutputWriter{stream: "stdout", buffer: &output, onOutput: onOutput, callbackMu: &callbackMu}
	cmd.Stderr = &buildOutputWriter{stream: "stderr", buffer: &output, onOutput: onOutput, callbackMu: &callbackMu}
	err = cmd.Run()
	text := strings.TrimSpace(output.String())
	if err != nil {
		if IsHostToolchainMismatch(text) {
			return text, fmt.Errorf("%w: self-evolution host build failed: %w", ErrHostBuildToolchainMismatch, err)
		}
		return text, fmt.Errorf("self-evolution host build failed: %w", err)
	}
	after, guardErr := buildGuardSnapshot(m.root)
	if guardErr != nil {
		return text, fmt.Errorf("capture post-build source guard: %w", guardErr)
	}
	if changed := changedGuardPaths(before, after); len(changed) > 0 {
		return text, fmt.Errorf("self-evolution host build mutated source dependency metadata outside the verified patch result: %s", strings.Join(changed, ", "))
	}
	return text, nil
}

func (m *Manager) RecordBuiltSourceFingerprint(ctx context.Context) error {
	if !m.Enabled() {
		return errors.New("Wharnex runtime root is not available")
	}
	cmd := exec.CommandContext(ctx, filepath.Join(m.root, "scripts", "source-fingerprint.sh"), "write")
	cmd.Dir = m.root
	cmd.Env = append(os.Environ(), "WHARNESS_ROOT="+m.root)
	if output, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("record completed self-evolution build fingerprint: %w: %s", err, strings.TrimSpace(string(output)))
	}
	return nil
}

func buildGuardSnapshot(root string) (map[string]string, error) {
	state := make(map[string]string, len(buildGuardPaths))
	for _, relative := range buildGuardPaths {
		path := filepath.Join(root, relative)
		data, err := os.ReadFile(path)
		if errors.Is(err, os.ErrNotExist) {
			state[relative] = "<absent>"
			continue
		}
		if err != nil {
			return nil, err
		}
		sum := sha256.Sum256(data)
		state[relative] = hex.EncodeToString(sum[:])
	}
	return state, nil
}

func changedGuardPaths(before, after map[string]string) []string {
	changed := make([]string, 0)
	for _, relative := range buildGuardPaths {
		if before[relative] != after[relative] {
			changed = append(changed, relative)
		}
	}
	return changed
}

func (m *Manager) ScheduleRestart(tx Transaction, sessionID, planID string) error {
	if tx.Root != m.root || tx.Worker == "" {
		return errors.New("invalid self-evolution transaction")
	}
	if strings.EqualFold(strings.TrimSpace(os.Getenv("WHARNESS_SERVICES_MODE")), "stack") {
		return m.scheduleStackRestart(tx, sessionID, planID)
	}
	logPath := filepath.Join(m.root, ".harness", "logs", "self-evolution.log")
	if err := os.MkdirAll(filepath.Dir(logPath), 0o700); err != nil {
		return err
	}
	logFile, err := os.OpenFile(logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer logFile.Close()
	cmd := exec.Command(tx.Worker, m.root, tx.Dir, sanitizeLabel(sessionID), sanitizeLabel(planID), strings.Join(tx.ActivationImpacts, ","))
	cmd.Dir = m.root
	cmd.Env = append(os.Environ(), "WHARNESS_ROOT="+m.root)
	cmd.Stdout = logFile
	cmd.Stderr = logFile
	cmd.Stdin = nil
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start detached self-restart worker: %w", err)
	}
	return cmd.Process.Release()
}

func (m *Manager) scheduleStackRestart(tx Transaction, sessionID, planID string) error {
	image := strings.TrimSpace(os.Getenv("WHARNESS_BACKEND_IMAGE"))
	dockerGID := strings.TrimSpace(os.Getenv("WHARNESS_DOCKER_GID"))
	home := strings.TrimSpace(os.Getenv("HOME"))
	if image == "" || dockerGID == "" || home == "" {
		return errors.New("stack self-restart environment is incomplete")
	}
	name := SupervisorContainerName(tx.ID)
	args := []string{
		"run", "-d", "--rm", "--name", name,
		"--network", "host",
		"--user", fmt.Sprintf("%d:%d", os.Getuid(), os.Getgid()),
		"--group-add", dockerGID,
		"-e", "HOME=" + home,
		"-e", "WHARNESS_ROOT=" + m.root,
		"-e", "WHARNESS_SERVICES_MODE=stack",
		"-e", "WHARNESS_BACKEND_IMAGE=" + image,
		"-e", "WHARNESS_DOCKER_GID=" + dockerGID,
		"-v", home + ":" + home,
		"-v", "/var/run/docker.sock:/var/run/docker.sock",
		"--entrypoint", tx.Worker,
		image,
		m.root, tx.Dir, sanitizeLabel(sessionID), sanitizeLabel(planID), strings.Join(tx.ActivationImpacts, ","),
	}
	output, err := exec.Command("docker", args...).CombinedOutput()
	if err != nil {
		return fmt.Errorf("start stack self-restart supervisor: %w: %s", err, strings.TrimSpace(string(output)))
	}
	return nil
}
