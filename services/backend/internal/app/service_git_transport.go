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

func gitRemoteDeleteBranch(ctx context.Context, root, remote, branch string) (hostrepo.PushResult, error) {
	socket := strings.TrimSpace(os.Getenv("HARNESS_HOST_GIT_SOCKET"))
	if socket == "" {
		return hostrepo.DeleteRemoteBranch(ctx, root, remote, branch)
	}
	result, err := sandbox.RunHostGit(ctx, socket, sandbox.HostGitRequest{Operation: "delete_branch", Root: root, Remote: remote, Branch: branch})
	if err != nil {
		return hostrepo.PushResult{}, err
	}
	return hostrepo.InterpretPushResult(remote, branch, result.Output, result.ExitCode == 0), nil
}

func gitRemotePushTag(ctx context.Context, root, remote, tag string) (hostrepo.PushResult, error) {
	socket := strings.TrimSpace(os.Getenv("HARNESS_HOST_GIT_SOCKET"))
	if socket == "" {
		return hostrepo.PushTag(ctx, root, remote, tag)
	}
	result, err := sandbox.RunHostGit(ctx, socket, sandbox.HostGitRequest{Operation: "push_tag", Root: root, Remote: remote, Tag: tag})
	if err != nil {
		return hostrepo.PushResult{}, err
	}
	return hostrepo.InterpretPushResult(remote, tag, result.Output, result.ExitCode == 0), nil
}

func gitRemoteCreateGitHubRelease(ctx context.Context, root, remote, tag, title, body string) (string, error) {
	request := sandbox.HostGitRequest{Operation: "github_release", Root: root, Remote: remote, Tag: tag, Title: title, Body: body}
	socket := strings.TrimSpace(os.Getenv("HARNESS_HOST_GIT_SOCKET"))
	if socket == "" {
		return sandbox.CreateGitHubRelease(ctx, request)
	}
	result, err := sandbox.RunHostGit(ctx, socket, request)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(result.Output), nil
}
