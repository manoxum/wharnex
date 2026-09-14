package sandbox

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/creack/pty"
)

type processTerminal struct {
	file      *os.File
	cmd       *exec.Cmd
	cleanup   func()
	closeOnce sync.Once
}

func (t *processTerminal) Write(data []byte) error {
	_, err := t.file.Write(data)
	return err
}

func (t *processTerminal) Resize(cols, rows uint16) error {
	return pty.Setsize(t.file, &pty.Winsize{Cols: cols, Rows: rows})
}

func (t *processTerminal) Close() error {
	var closeErr error
	t.closeOnce.Do(func() {
		closeErr = t.file.Close()
		if t.cmd.Process != nil {
			_ = t.cmd.Process.Kill()
		}
		if t.cleanup != nil {
			t.cleanup()
		}
	})
	return closeErr
}

func startProcessTerminal(cmd *exec.Cmd, options TerminalOptions, cleanup func(), onOutput func([]byte), onExit func(int, error)) (InteractiveTerminal, error) {
	file, err := pty.StartWithSize(cmd, &pty.Winsize{Cols: options.Cols, Rows: options.Rows})
	if err != nil {
		if cleanup != nil {
			cleanup()
		}
		return nil, err
	}
	terminal := &processTerminal{file: file, cmd: cmd, cleanup: cleanup}
	readDone := make(chan struct{})
	go func() {
		defer close(readDone)
		buffer := make([]byte, 32*1024)
		for {
			n, readErr := file.Read(buffer)
			if n > 0 && onOutput != nil {
				onOutput(append([]byte(nil), buffer[:n]...))
			}
			if readErr != nil {
				return
			}
		}
	}()
	go func() {
		waitErr := cmd.Wait()
		code := exitCode(waitErr)
		select {
		case <-readDone:
		case <-time.After(time.Second):
		}
		_ = terminal.Close()
		if onExit != nil {
			onExit(code, waitErr)
		}
	}()
	return terminal, nil
}

func terminalShell() string {
	if shell := strings.TrimSpace(os.Getenv("SHELL")); filepath.IsAbs(shell) {
		if info, err := os.Stat(shell); err == nil && !info.IsDir() && info.Mode()&0o111 != 0 {
			return shell
		}
	}
	for _, shell := range []string{"/bin/bash", "/bin/sh"} {
		if _, err := os.Stat(shell); err == nil {
			return shell
		}
	}
	return "/bin/sh"
}

func localTerminalCommand(workspace Workspace, options TerminalOptions) (*exec.Cmd, error) {
	cwd, err := safeWorkspaceCwd(workspace.Path, options.Cwd)
	if err != nil {
		return nil, err
	}
	shell := terminalShell()
	cmd := exec.Command(shell, interactiveShellArgs(shell)...)
	cmd.Dir = cwd
	cmd.Env = append(os.Environ(), "TERM=xterm-256color", "COLORTERM=truecolor")
	return cmd, nil
}

func interactiveShellArgs(shell string) []string {
	if filepath.Base(shell) == "bash" {
		return []string{"--login", "-i"}
	}
	return []string{"-l"}
}

func (r *HostRunner) StartInteractive(workspace Workspace, options TerminalOptions, onOutput func([]byte), onExit func(int, error)) (InteractiveTerminal, error) {
	cmd, err := localTerminalCommand(workspace, options)
	if err != nil {
		return nil, err
	}
	return startProcessTerminal(cmd, options, nil, onOutput, onExit)
}

func (r *LocalRunner) StartInteractive(workspace Workspace, options TerminalOptions, onOutput func([]byte), onExit func(int, error)) (InteractiveTerminal, error) {
	cmd, err := localTerminalCommand(workspace, options)
	if err != nil {
		return nil, err
	}
	return startProcessTerminal(cmd, options, nil, onOutput, onExit)
}

func (r *DockerRunner) StartInteractive(workspace Workspace, options TerminalOptions, onOutput func([]byte), onExit func(int, error)) (InteractiveTerminal, error) {
	if _, err := safeWorkspaceCwd(workspace.Path, options.Cwd); err != nil {
		return nil, err
	}
	if _, err := exec.LookPath("docker"); err != nil {
		return nil, errors.New("docker CLI not found; build/install Docker or use explicitly-enabled local dev sandbox")
	}
	if err := refuseDockerSocketActivation(); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Join(workspace.Path, ".kernl", "go-build"), 0o700); err != nil {
		return nil, fmt.Errorf("prepare sandbox build cache: %w", err)
	}
	network := "none"
	if options.Network {
		network = "bridge"
	}
	containerCwd := "/workspace"
	if options.Cwd != "" && options.Cwd != "." {
		containerCwd += "/" + filepath.ToSlash(filepath.Clean(options.Cwd))
	}
	name := "wharnex-terminal-" + sanitizeContainerName(options.ID)
	limits := CurrentRunnerLimits()
	args := []string{"run", "--rm", "--interactive", "--tty", "--name", name, "--read-only", "--network", network,
		"--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
		"--pids-limit", strconv.Itoa(limits.Pids), "--memory", limits.Memory, "--cpus", limits.CPUs,
		"--tmpfs", "/tmp:rw,exec,nosuid,nodev,size=" + limits.TmpfsSize,
		"--env", "HOME=/tmp/kernl-home", "--env", "XDG_CACHE_HOME=/tmp/cache",
		"--env", "GOCACHE=" + workspaceGoBuildCache, "--env", "GOMODCACHE=/workspace/.kernl/go-mod",
		"--env", "npm_config_cache=/tmp/npm", "--env", "TERM=xterm-256color", "--env", "COLORTERM=truecolor",
		"--user", strconv.Itoa(os.Getuid()) + ":" + strconv.Itoa(os.Getgid()),
		"--volume", workspace.Path + ":/workspace:rw", "--workdir", containerCwd,
	}
	if !options.Network {
		args = append(args, "--env", "GOPROXY=off")
	}
	args = append(args, r.image, "/bin/bash", "--login", "-i")
	cleanup := func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = exec.CommandContext(ctx, "docker", "rm", "-f", name).Run()
	}
	return startProcessTerminal(exec.Command("docker", args...), options, cleanup, onOutput, onExit)
}

func sanitizeContainerName(value string) string {
	value = strings.Map(func(r rune) rune {
		if r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '_' || r == '-' {
			return r
		}
		return '-'
	}, value)
	if value == "" {
		return "session"
	}
	return value
}

var _ InteractiveTerminalRunner = (*DockerRunner)(nil)
var _ InteractiveTerminalRunner = (*LocalRunner)(nil)
var _ InteractiveTerminalRunner = (*HostRunner)(nil)
