package app

import (
	"context"
	"errors"
	"os"
	"strings"

	"kernl.local/harness/backend/internal/hostrepo"
	"kernl.local/harness/backend/internal/sandbox"
)

func gitRemotePush(ctx context.Context, root, remote, branch string, setUpstream bool) (hostrepo.PushResult, error) {
	socket := strings.TrimSpace(os.Getenv("HARNESS_HOST_GIT_SOCKET"))
	if socket == "" {
		return hostrepo.Push(ctx, root, remote, branch, setUpstream)
	}
	result, err := sandbox.RunHostGit(ctx, socket, sandbox.HostGitRequest{
		Operation: "push", Root: root, Remote: remote, Branch: branch, SetUpstream: setUpstream,
	})
	if err != nil {
		return hostrepo.PushResult{}, err
	}
	return hostrepo.InterpretPushResult(remote, branch, result.Output, result.ExitCode == 0), nil
}

func gitRemotePushCommit(ctx context.Context, root, remote, branch, sha string) (hostrepo.PushResult, error) {
	socket := strings.TrimSpace(os.Getenv("HARNESS_HOST_GIT_SOCKET"))
	if socket == "" {
		return hostrepo.PushCommit(ctx, root, remote, branch, sha)
	}
	result, err := sandbox.RunHostGit(ctx, socket, sandbox.HostGitRequest{
		Operation: "push_commit", Root: root, Remote: remote, Branch: branch, CommitSHA: sha,
	})
	if err != nil {
		return hostrepo.PushResult{}, err
	}
	return hostrepo.InterpretPushResult(remote, branch, result.Output, result.ExitCode == 0), nil
}

func gitRemoteFetch(ctx context.Context, root, remote string) error {
	socket := strings.TrimSpace(os.Getenv("HARNESS_HOST_GIT_SOCKET"))
	if socket == "" {
		return hostrepo.Fetch(ctx, root, remote)
	}
	result, err := sandbox.RunHostGit(ctx, socket, sandbox.HostGitRequest{Operation: "fetch", Root: root, Remote: remote})
	if err != nil {
		return err
	}
	if result.ExitCode != 0 {
		detail := strings.TrimSpace(hostrepo.RedactRemoteURL(result.Output))
		if detail == "" {
			detail = "git exited without diagnostic output"
		}
		return errors.New("fetch " + remote + ": " + detail)
	}
	return nil
}
