package sandbox

import (
	"context"
	"strconv"
	"strings"
)

// requestBaseSubjectPrefix opens the message of every request-base commit
// CaptureRequestBase records. Together with the fixed internal author email it
// identifies such a commit structurally, whether or not its anchor ref still
// exists and whether or not the repository reading it carries refs/wharnex/*.
const requestBaseSubjectPrefix = "Wharnex request base "

// candidateBaseSearchDepth bounds the first-parent walk. A candidate branch is
// its request base plus a handful of commits (replayed predecessors and the
// verified change itself); a base further away than this is not the one the
// candidate was authored against.
const candidateBaseSearchDepth = 64

// CandidateMergeBase returns the request base a candidate commit was authored
// against: the nearest Wharnex request-base commit on its first-parent chain.
// An empty result means the candidate carries no such commit (a legacy or
// non-base-rooted candidate) and Git's own merge-base must decide.
//
// This, not Git's computed common ancestor, is the correct base for
// integrating a candidate. A request base is the host's HEAD *plus the
// operator's uncommitted work* at request time, recorded as a commit parented
// on HEAD. The host's current tree does not descend from it, so Git picks that
// bare HEAD as the merge-base — a tree that holds none of the operator's work.
// Every operator edit present in the base then counts as a change made by the
// candidate: a file the operator created is an add/add conflict the moment the
// candidate or the operator touches it again, a line the operator kept editing
// conflicts with its own earlier version, and an edit the operator discarded
// is silently resurrected by the merge. With the request base as merge-base,
// the candidate side contributes exactly the verified change and the host side
// contributes exactly what happened on the host since the request was taken,
// which is the question the integration is actually asking.
func CandidateMergeBase(ctx context.Context, repoPath, tip string) string {
	tip = strings.TrimSpace(tip)
	if tip == "" {
		return ""
	}
	output, err := runGit(ctx, repoPath, "log", "--first-parent", "--format=%H%x1f%ae%x1f%s",
		"--max-count="+strconv.Itoa(candidateBaseSearchDepth), tip, "--")
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(output, "\n") {
		fields := strings.SplitN(strings.TrimSpace(line), "\x1f", 3)
		if len(fields) != 3 {
			continue
		}
		if fields[1] == gitCommitAuthorEmail && strings.HasPrefix(fields[2], requestBaseSubjectPrefix) {
			return fields[0]
		}
	}
	return ""
}

// candidateMergeBaseOrRef prefers the base found in the candidate's own
// ancestry. A caller-supplied request-base ref is accepted only when it is
// provably an ancestor of the candidate: a branch re-anchored onto a newer
// request's base (adr/ADR-0067) no longer descends from the base its plan was
// first requested with, and merging from that stale base would replay the
// difference between the two bases as if the candidate had authored it.
func candidateMergeBaseOrRef(ctx context.Context, repoPath, tip, requestBaseRef string) string {
	if base := CandidateMergeBase(ctx, repoPath, tip); base != "" {
		return base
	}
	requestBaseRef = strings.TrimSpace(requestBaseRef)
	if requestBaseRef == "" {
		return ""
	}
	base, err := ResolveRef(ctx, repoPath, requestBaseRef)
	if err != nil {
		return ""
	}
	if _, err := runGit(ctx, repoPath, "merge-base", "--is-ancestor", base, tip); err != nil {
		return ""
	}
	return base
}
