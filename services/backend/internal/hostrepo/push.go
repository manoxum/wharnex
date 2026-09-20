package hostrepo

import (
	"context"
	"errors"
	"strings"
)

// PushOutcome is the closed set of results a push can have. The distinction
// that matters is between a rejection Wharnex can do something about
// (integrating the remote's work) and a failure it cannot (credentials,
// network, a protected branch).
type PushOutcome string

const (
	// PushOutcomePushed: refs advanced on the remote.
	PushOutcomePushed PushOutcome = "pushed"
	// PushOutcomeUpToDate: the remote already had everything.
	PushOutcomeUpToDate PushOutcome = "up_to_date"
	// PushOutcomeRejected: non-fast-forward. The remote holds commits the
	// local branch does not, and integrating them is the defined next step.
	PushOutcomeRejected PushOutcome = "rejected"
	// PushOutcomeAuthRequired: the remote wants credentials Wharnex will not
	// prompt for. GIT_TERMINAL_PROMPT=0 makes this fail fast instead of
	// hanging a request on an invisible password prompt.
	PushOutcomeAuthRequired PushOutcome = "auth_required"
	// PushOutcomeFailed: anything else, reported verbatim but redacted.
	PushOutcomeFailed PushOutcome = "failed"
)

// PushResult reports one push attempt.
type PushResult struct {
	Outcome PushOutcome `json:"outcome"`
	Remote  string      `json:"remote"`
	Branch  string      `json:"branch"`
	// Detail is Git's own message with any credential-bearing URL redacted.
	Detail string `json:"detail,omitempty"`
}

// Succeeded reports a push that left the remote holding the local branch.
func (r PushResult) Succeeded() bool {
	return r.Outcome == PushOutcomePushed || r.Outcome == PushOutcomeUpToDate
}

// Push sends one local branch to one remote.
//
// Force is deliberately not a parameter. A force push rewrites history other
// people may already have, and nothing in the Wharnex workflow needs it: a
// rejected push means the remote has work to integrate, which is a merge, not
// an overwrite. Offering the flag at all would make discarding a colleague's
// commits a single click in a surface whose whole purpose is assisted, safe
// history.
func Push(ctx context.Context, root, remote, branch string, setUpstream bool) (PushResult, error) {
	remote, branch = strings.TrimSpace(remote), strings.TrimSpace(branch)
	if remote == "" || branch == "" {
		return PushResult{}, errors.New("a remote and a branch are required")
	}
	if strings.HasPrefix(remote, "-") || strings.HasPrefix(branch, "-") {
		return PushResult{}, errors.New("remote and branch must not look like options")
	}
	args := []string{"push"}
	if setUpstream {
		args = append(args, "--set-upstream")
	}
	args = append(args, "--", remote, branch+":refs/heads/"+branch)
	return pushWithArgs(ctx, root, remote, branch, args)
}

// PushCommit advances one remote branch only through a selected local commit.
// It is intentionally fast-forward-only and never configures upstream state:
// callers use it only after proving the current branch already tracks the
// destination and the selected commits form the oldest contiguous prefix of
// the branch's unpushed history.
func PushCommit(ctx context.Context, root, remote, branch, sha string) (PushResult, error) {
	remote, branch, sha = strings.TrimSpace(remote), strings.TrimSpace(branch), strings.TrimSpace(sha)
	if remote == "" || branch == "" || len(sha) != 40 {
		return PushResult{}, errors.New("a remote, branch and full commit sha are required")
	}
	if strings.HasPrefix(remote, "-") || strings.HasPrefix(branch, "-") {
		return PushResult{}, errors.New("remote and branch must not look like options")
	}
	for _, r := range sha {
		if !((r >= '0' && r <= '9') || (r >= 'a' && r <= 'f') || (r >= 'A' && r <= 'F')) {
			return PushResult{}, errors.New("invalid commit sha")
		}
	}
	args := []string{"push", "--", remote, sha + ":refs/heads/" + branch}
	return pushWithArgs(ctx, root, remote, branch, args)
}

func pushWithArgs(ctx context.Context, root, remote, branch string, args []string) (PushResult, error) {
	output, err := run(ctx, root, args...)
	return InterpretPushResult(remote, branch, output, err == nil), nil
}

// InterpretPushResult applies the same push semantics to output produced by
// either the local Git process or the restricted native-host Git bridge.
func InterpretPushResult(remote, branch, output string, succeeded bool) PushResult {
	detail := RedactRemoteURL(output)
	if succeeded {
		if strings.Contains(output, "Everything up-to-date") {
			return PushResult{Outcome: PushOutcomeUpToDate, Remote: remote, Branch: branch, Detail: detail}
		}
		return PushResult{Outcome: PushOutcomePushed, Remote: remote, Branch: branch, Detail: detail}
	}
	return PushResult{Outcome: classifyPushFailure(output), Remote: remote, Branch: branch, Detail: detail}
}

// classifyPushFailure reads Git's own refusal. Matching on Git's message is
// unavoidable here — push reports per-ref status in prose and offers no
// machine-readable failure code — so the matched phrases are the stable ones
// Git has used for many releases, and anything unrecognised degrades to
// PushOutcomeFailed rather than to a wrong recovery.
func classifyPushFailure(output string) PushOutcome {
	lowered := strings.ToLower(output)
	for _, marker := range []string{
		"could not read username", "could not read password", "authentication failed",
		"permission denied", "invalid username or token", "terminal prompts disabled",
	} {
		if strings.Contains(lowered, marker) {
			return PushOutcomeAuthRequired
		}
	}
	if strings.Contains(lowered, "[rejected]") || strings.Contains(lowered, "non-fast-forward") || strings.Contains(lowered, "fetch first") {
		return PushOutcomeRejected
	}
	return PushOutcomeFailed
}

// Fetch updates remote-tracking refs for one remote without touching the
// working tree, index or any local branch.
func Fetch(ctx context.Context, root, remote string) error {
	remote = strings.TrimSpace(remote)
	if remote == "" || strings.HasPrefix(remote, "-") {
		return errors.New("a remote is required")
	}
	if output, err := run(ctx, root, "fetch", "--quiet", "--prune", "--no-tags", "--", remote); err != nil {
		return errors.New("fetch " + remote + ": " + RedactRemoteURL(output))
	}
	return nil
}
