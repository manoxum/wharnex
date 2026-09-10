package hostrepo

import (
	"context"
	"fmt"
	"strings"
	"time"
)

// Commit is one entry of the host's own history, as the Git surface presents
// it to a human.
type Commit struct {
	SHA         string    `json:"sha"`
	ShortSHA    string    `json:"short_sha"`
	Subject     string    `json:"subject"`
	Body        string    `json:"body,omitempty"`
	AuthorName  string    `json:"author_name"`
	AuthorEmail string    `json:"author_email"`
	CommittedAt time.Time `json:"committed_at"`
	// RequestID/PlanID come from the trailers every Wharnex-originated commit
	// message carries.
	RequestID string `json:"request_id,omitempty"`
	PlanID    string `json:"plan_id,omitempty"`
	// Wharnex marks a commit that originated from a Wharnex change.
	//
	// It is decided by the trailers rather than by the author identity,
	// because the two diverge by design: in auto-commit mode Wharnex is the
	// author, while a commit the operator makes themselves from the Git
	// surface carries their own identity and the same Wharnex-authored
	// message. Author-based detection would lose exactly the commits the
	// manual mode exists to produce.
	Wharnex bool `json:"wharnex"`
	// Merge marks a merge commit.
	Merge bool `json:"merge"`
	// Pushed is true when the commit is already reachable from the branch's
	// upstream. False means it is local-only.
	Pushed bool `json:"pushed"`
}

// commitFieldSeparator/commitRecordSeparator are ASCII control characters that
// cannot occur in a sanitized commit message, so a body containing newlines,
// tabs or blank lines still parses as one record.
const (
	commitFieldSeparator  = "\x1f"
	commitRecordSeparator = "\x1e"
)

// Log reads the current branch's recent history.
//
// Wharnex-originated commits are identified by their `Request-Id` trailer,
// which the change protocol already requires on every integrated change, so
// the log itself is the record of what Wharnex has committed — no parallel
// bookkeeping that could drift from the repository's real state.
func Log(ctx context.Context, root string, limit int) ([]Commit, error) {
	if limit <= 0 {
		limit = 50
	}
	format := strings.Join([]string{"%H", "%h", "%an", "%ae", "%cI", "%P", "%s", "%b"}, commitFieldSeparator) + commitRecordSeparator
	output, err := run(ctx, root, "log", "--no-color", fmt.Sprintf("--max-count=%d", limit), "--format="+format)
	if err != nil {
		// A repository with no commit yet is an empty log, not a failure.
		if strings.Contains(output, "does not have any commits") || strings.Contains(output, "unknown revision") {
			return []Commit{}, nil
		}
		return nil, fmt.Errorf("read history: %s", output)
	}
	unpushed := unpushedCommits(ctx, root)
	commits := make([]Commit, 0)
	for _, record := range strings.Split(output, commitRecordSeparator) {
		record = strings.TrimLeft(record, "\n")
		if strings.TrimSpace(record) == "" {
			continue
		}
		fields := strings.Split(record, commitFieldSeparator)
		if len(fields) < 8 {
			continue
		}
		commit := Commit{
			SHA: fields[0], ShortSHA: fields[1], AuthorName: fields[2], AuthorEmail: fields[3],
			Subject: fields[6], Body: strings.TrimSpace(fields[7]),
			Merge: len(strings.Fields(fields[5])) > 1,
		}
		if when, parseErr := time.Parse(time.RFC3339, fields[4]); parseErr == nil {
			commit.CommittedAt = when.UTC()
		}
		commit.RequestID = trailerValue(commit.Body, "Request-Id")
		commit.PlanID = trailerValue(commit.Body, "Plan-Id")
		commit.Wharnex = commit.RequestID != "" || strings.EqualFold(commit.AuthorEmail, CommitAuthorEmail)
		// With no upstream nothing is provably pushed, and unpushedCommits
		// returns nil; treating that as "everything pushed" would be the
		// dangerous direction, so absence of proof means not pushed.
		commit.Pushed = unpushed != nil && !unpushed[commit.SHA]
		commits = append(commits, commit)
	}
	return commits, nil
}

// unpushedCommits returns the set of commits on the current branch that its
// upstream does not contain. A nil result means the question is unanswerable
// (no upstream, or no HEAD), which callers must not read as "all pushed".
func unpushedCommits(ctx context.Context, root string) map[string]bool {
	upstream, err := run(ctx, root, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}")
	if err != nil || strings.TrimSpace(upstream) == "" {
		return nil
	}
	output, err := run(ctx, root, "rev-list", upstream+"..HEAD")
	if err != nil {
		return nil
	}
	unpushed := map[string]bool{}
	for _, sha := range strings.Fields(output) {
		unpushed[sha] = true
	}
	return unpushed
}

// trailerValue reads one Git trailer from a commit body.
func trailerValue(body, key string) string {
	prefix := key + ":"
	for _, line := range strings.Split(body, "\n") {
		line = strings.TrimSpace(line)
		if len(line) > len(prefix) && strings.EqualFold(line[:len(prefix)], prefix) {
			return strings.TrimSpace(line[len(prefix):])
		}
	}
	return ""
}

// DiffBetween returns the unified diff between two commits, bounded so one
// enormous change cannot blow out a stored record or an API response.
func DiffBetween(ctx context.Context, root, fromSHA, toSHA string, limitBytes int) (diff string, truncated bool, err error) {
	fromSHA, toSHA = strings.TrimSpace(fromSHA), strings.TrimSpace(toSHA)
	if fromSHA == "" || toSHA == "" {
		return "", false, nil
	}
	output, err := runRaw(ctx, root, "diff", "--no-color", fromSHA, toSHA)
	if err != nil {
		return "", false, fmt.Errorf("diff %s..%s failed", fromSHA, toSHA)
	}
	if limitBytes > 0 && len(output) > limitBytes {
		return output[:limitBytes], true, nil
	}
	return output, false, nil
}

// WorktreeDiff returns the current uncommitted diff against HEAD, including
// untracked files, bounded the same way.
func WorktreeDiff(ctx context.Context, root string, paths []string, limitBytes int) (diff string, truncated bool, err error) {
	args := []string{"diff", "--no-color", "HEAD"}
	if len(paths) > 0 {
		args = append(args, "--")
		args = append(args, paths...)
	}
	output, err := runRaw(ctx, root, args...)
	if err != nil {
		return "", false, fmt.Errorf("read worktree diff failed")
	}
	if limitBytes > 0 && len(output) > limitBytes {
		return output[:limitBytes], true, nil
	}
	return output, false, nil
}
