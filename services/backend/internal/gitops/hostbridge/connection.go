// Package hostbridge dispatches the restricted host Git socket vocabulary.
package hostbridge

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"os"
	"os/exec"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/gitops"
	"kernl.local/harness/backend/internal/gitops/recovery"
)

// ServeConnection composes existing remote-operation adapters with the narrow
// host-only lock recovery. There is no argv or deletion-path field in recovery.
func ServeConnection(parent context.Context, conn net.Conn,
	release func(context.Context, gitops.HostRequest) (string, error),
	arguments func(gitops.HostRequest) ([]string, error),
) {
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(2 * time.Minute))
	var request gitops.HostRequest
	encoder := json.NewEncoder(conn)
	decoder := json.NewDecoder(io.LimitReader(conn, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		_ = encoder.Encode(gitops.HostResult{ExitCode: -1, Error: "invalid host Git request"})
		return
	}
	ctx, cancel := context.WithTimeout(parent, 2*time.Minute)
	defer cancel()
	if request.Operation == "recover_index_lock" {
		if request.Remote != "" || request.Branch != "" || request.CommitSHA != "" || request.Tag != "" ||
			request.Title != "" || request.Body != "" || request.SetUpstream || len(request.Root) > 4096 {
			_ = encoder.Encode(gitops.HostResult{ExitCode: -1, Error: "invalid lock recovery request"})
			return
		}
		proofCtx, stop := context.WithTimeout(ctx, 2*time.Second)
		result := recovery.ClearOnHost(proofCtx, request.Root)
		stop()
		_ = encoder.Encode(gitops.HostResult{Recovery: &result})
		return
	}
	if request.Operation == "github_release" {
		releaseURL, err := release(ctx, request)
		if err != nil {
			_ = encoder.Encode(gitops.HostResult{ExitCode: -1, Error: err.Error()})
			return
		}
		_ = encoder.Encode(gitops.HostResult{Output: releaseURL})
		return
	}
	args, err := arguments(request)
	if err != nil {
		_ = encoder.Encode(gitops.HostResult{ExitCode: -1, Error: err.Error()})
		return
	}
	cmd := exec.CommandContext(ctx, "git", append([]string{"-C", request.Root}, args...)...)
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0", "GIT_OPTIONAL_LOCKS=0")
	output, runErr := cmd.CombinedOutput()
	if len(output) > 1<<20 {
		output = output[:1<<20]
	}
	result := gitops.HostResult{Output: strings.TrimSpace(string(output))}
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
