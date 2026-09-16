package sandbox

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

const maxHostGitOutputBytes = 1024 * 1024

type HostGitRequest struct {
	Operation   string `json:"operation"`
	Root        string `json:"root"`
	Remote      string `json:"remote"`
	Branch      string `json:"branch,omitempty"`
	CommitSHA   string `json:"commit_sha,omitempty"`
	SetUpstream bool   `json:"set_upstream,omitempty"`
}

type HostGitResult struct {
	Output   string `json:"output,omitempty"`
	ExitCode int    `json:"exit_code"`
	Error    string `json:"error,omitempty"`
}

func RunHostGit(ctx context.Context, socketPath string, request HostGitRequest) (HostGitResult, error) {
	socketPath = strings.TrimSpace(socketPath)
	if socketPath == "" || !filepath.IsAbs(socketPath) {
		return HostGitResult{}, errors.New("host Git bridge socket must be an absolute path")
	}
	conn, err := (&net.Dialer{}).DialContext(ctx, "unix", socketPath)
	if err != nil {
		return HostGitResult{}, fmt.Errorf("connect host Git bridge: %w", err)
	}
	defer conn.Close()
	if deadline, ok := ctx.Deadline(); ok {
		_ = conn.SetDeadline(deadline)
	}
	if err := json.NewEncoder(conn).Encode(request); err != nil {
		return HostGitResult{}, fmt.Errorf("send host Git request: %w", err)
	}
	var result HostGitResult
	if err := json.NewDecoder(conn).Decode(&result); err != nil {
		return HostGitResult{}, fmt.Errorf("read host Git response: %w", err)
	}
	if result.Error != "" {
		return result, errors.New(result.Error)
	}
	return result, nil
}

func ServeHostGitBridge(ctx context.Context, socketPath string) error {
	socketPath = strings.TrimSpace(socketPath)
	if socketPath == "" || !filepath.IsAbs(socketPath) {
		return errors.New("host Git bridge socket must be an absolute path")
	}
	if err := os.MkdirAll(filepath.Dir(socketPath), 0o700); err != nil {
		return fmt.Errorf("prepare host Git bridge directory: %w", err)
	}
	if err := removeStaleUnixSocket(socketPath); err != nil {
		return err
	}
	listener, err := net.Listen("unix", socketPath)
	if err != nil {
		return fmt.Errorf("listen host Git bridge: %w", err)
	}
	defer func() { _ = listener.Close(); _ = os.Remove(socketPath) }()
	if err := os.Chmod(socketPath, 0o600); err != nil {
		return fmt.Errorf("secure host Git bridge socket: %w", err)
	}
	go func() { <-ctx.Done(); _ = listener.Close() }()
	for {
		conn, err := listener.Accept()
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			return fmt.Errorf("accept host Git bridge connection: %w", err)
		}
		go handleHostGitConnection(ctx, conn)
	}
}

func removeStaleUnixSocket(socketPath string) error {
	info, err := os.Lstat(socketPath)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if info.Mode()&os.ModeSocket == 0 {
		return fmt.Errorf("refusing to replace non-socket host Git bridge path %s", socketPath)
	}
	probe, dialErr := net.DialTimeout("unix", socketPath, 250*time.Millisecond)
	if dialErr == nil {
		_ = probe.Close()
		return fmt.Errorf("host Git bridge is already listening on %s", socketPath)
	}
	if err := os.Remove(socketPath); err != nil {
		return fmt.Errorf("remove stale host Git bridge socket: %w", err)
	}
	return nil
}

func handleHostGitConnection(parent context.Context, conn net.Conn) {
	defer conn.Close()
	var request HostGitRequest
	encoder := json.NewEncoder(conn)
	if err := json.NewDecoder(conn).Decode(&request); err != nil {
		_ = encoder.Encode(HostGitResult{ExitCode: -1, Error: "invalid host Git request"})
		return
	}
	args, err := hostGitArgs(request)
	if err != nil {
		_ = encoder.Encode(HostGitResult{ExitCode: -1, Error: err.Error()})
		return
	}
	ctx, cancel := context.WithTimeout(parent, 2*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, "git", append([]string{"-C", request.Root}, args...)...)
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	output, runErr := cmd.CombinedOutput()
	if len(output) > maxHostGitOutputBytes {
		output = output[:maxHostGitOutputBytes]
	}
	result := HostGitResult{Output: strings.TrimSpace(string(output)), ExitCode: 0}
	if runErr != nil {
		result.ExitCode = -1
		var exitErr *exec.ExitError
		if errors.As(runErr, &exitErr) {
			result.ExitCode = exitErr.ExitCode()
		} else {
			result.Error = runErr.Error()
		}
	}
	_ = encoder.Encode(result)
}

func hostGitArgs(request HostGitRequest) ([]string, error) {
	request.Root = strings.TrimSpace(request.Root)
	request.Remote = strings.TrimSpace(request.Remote)
	request.Branch = strings.TrimSpace(request.Branch)
	request.CommitSHA = strings.TrimSpace(request.CommitSHA)
	if request.Root == "" || !filepath.IsAbs(request.Root) {
		return nil, errors.New("host Git root must be absolute")
	}
	if request.Remote == "" || strings.HasPrefix(request.Remote, "-") {
		return nil, errors.New("a valid remote is required")
	}
	switch request.Operation {
	case "fetch":
		return []string{"fetch", "--quiet", "--no-tags", "--", request.Remote}, nil
	case "push":
		if err := validateHostGitBranch(request.Branch); err != nil {
			return nil, err
		}
		args := []string{"push"}
		if request.SetUpstream {
			args = append(args, "--set-upstream")
		}
		return append(args, "--", request.Remote, request.Branch+":refs/heads/"+request.Branch), nil
	case "push_commit":
		if err := validateHostGitBranch(request.Branch); err != nil {
			return nil, err
		}
		if len(request.CommitSHA) != 40 || !isHexSHA(request.CommitSHA) {
			return nil, errors.New("invalid commit sha")
		}
		return []string{"push", "--", request.Remote, request.CommitSHA + ":refs/heads/" + request.Branch}, nil
	default:
		return nil, fmt.Errorf("unsupported host Git operation %q", request.Operation)
	}
}

func validateHostGitBranch(branch string) error {
	if branch == "" || strings.HasPrefix(branch, "-") {
		return errors.New("a valid branch is required")
	}
	return nil
}

func isHexSHA(value string) bool {
	for _, r := range value {
		if !((r >= '0' && r <= '9') || (r >= 'a' && r <= 'f') || (r >= 'A' && r <= 'F')) {
			return false
		}
	}
	return true
}
