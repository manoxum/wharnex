package hostrepo

import (
	"context"
	"fmt"
	"net/url"
	"strconv"
	"strings"
)

// Branch is one ref a human can act on from the Git surface: a local branch or
// a remote-tracking branch, with everything needed to decide what to do with
// it without a second round trip.
type Branch struct {
	// Name is the short name: "main" for a local branch, "origin/main" for a
	// remote-tracking one.
	Name string `json:"name"`
	// Remote is empty for a local branch, otherwise the remote it belongs to.
	Remote string `json:"remote,omitempty"`
	// Current marks the checked-out branch.
	Current bool `json:"current"`
	// CommitSHA and Subject describe the ref's tip.
	CommitSHA string `json:"commit_sha"`
	Subject   string `json:"subject,omitempty"`
	// Upstream is the configured upstream of a local branch, if any.
	Upstream string `json:"upstream,omitempty"`
	// Ahead/Behind count commits relative to Upstream. Both are zero when
	// there is no upstream, which is not the same as being in sync — HasUpstream
	// distinguishes those.
	Ahead       int  `json:"ahead"`
	Behind      int  `json:"behind"`
	HasUpstream bool `json:"has_upstream"`
	Gone        bool `json:"gone"`
}

// Remote is a configured remote with its URL redacted for display.
type Remote struct {
	Name string `json:"name"`
	URL  string `json:"url"`
}

// Branches lists local and remote-tracking branches in one pass.
//
// It reads `git for-each-ref` rather than `git branch`, because the porcelain
// command's output is presentation-formatted and locale-sensitive while
// for-each-ref's is a stable plumbing format that carries the tip, the
// upstream and the ahead/behind counts together.
func Branches(ctx context.Context, root string) ([]Branch, error) {
	const format = "%(refname)%09%(objectname)%09%(HEAD)%09%(upstream:short)%09%(upstream:track)%09%(contents:subject)"
	output, err := run(ctx, root, "for-each-ref", "--format="+format, "refs/heads", "refs/remotes")
	if err != nil {
		return nil, fmt.Errorf("list branches: %s", output)
	}
	branches := make([]Branch, 0)
	for _, line := range strings.Split(output, "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		fields := strings.SplitN(line, "\t", 6)
		if len(fields) < 5 {
			continue
		}
		branch := parseBranchRef(fields[0])
		if branch.Name == "" {
			continue
		}
		branch.CommitSHA = fields[1]
		branch.Current = strings.TrimSpace(fields[2]) == "*"
		branch.Upstream = strings.TrimSpace(fields[3])
		branch.HasUpstream = branch.Upstream != ""
		branch.Ahead, branch.Behind, branch.Gone = parseUpstreamTrack(fields[4])
		if len(fields) == 6 {
			branch.Subject = strings.TrimSpace(fields[5])
		}
		branches = append(branches, branch)
	}
	return branches, nil
}

// parseBranchRef turns a full refname into a short name plus its remote.
// `refs/remotes/<remote>/HEAD` is dropped: it is a symbolic pointer at the
// remote's default branch, not a branch a human merges or pushes.
func parseBranchRef(refName string) Branch {
	switch {
	case strings.HasPrefix(refName, "refs/heads/"):
		return Branch{Name: strings.TrimPrefix(refName, "refs/heads/")}
	case strings.HasPrefix(refName, "refs/remotes/"):
		short := strings.TrimPrefix(refName, "refs/remotes/")
		remote, rest, found := strings.Cut(short, "/")
		if !found || rest == "HEAD" {
			return Branch{}
		}
		return Branch{Name: short, Remote: remote}
	}
	return Branch{}
}

// parseUpstreamTrack reads for-each-ref's `%(upstream:track)` field, whose
// forms are "", "[gone]", "[ahead N]", "[behind N]" and "[ahead N, behind M]".
func parseUpstreamTrack(value string) (ahead, behind int, gone bool) {
	value = strings.Trim(strings.TrimSpace(value), "[]")
	if value == "" {
		return 0, 0, false
	}
	if value == "gone" {
		return 0, 0, true
	}
	for _, part := range strings.Split(value, ",") {
		part = strings.TrimSpace(part)
		label, count, found := strings.Cut(part, " ")
		if !found {
			continue
		}
		parsed, convErr := strconv.Atoi(strings.TrimSpace(count))
		if convErr != nil {
			continue
		}
		switch label {
		case "ahead":
			ahead = parsed
		case "behind":
			behind = parsed
		}
	}
	return ahead, behind, false
}

// Remotes lists configured remotes with credentials stripped from their URLs.
//
// Redaction is not cosmetic. A remote URL routinely embeds a personal access
// token as userinfo (`https://user:token@host/repo.git`), and this value is
// returned over the API, rendered in the UI and included in error text — all
// places a credential must never reach.
func Remotes(ctx context.Context, root string) ([]Remote, error) {
	output, err := run(ctx, root, "remote")
	if err != nil {
		return nil, fmt.Errorf("list remotes: %s", output)
	}
	remotes := make([]Remote, 0)
	for _, name := range strings.Fields(output) {
		raw, urlErr := run(ctx, root, "remote", "get-url", name)
		if urlErr != nil {
			remotes = append(remotes, Remote{Name: name})
			continue
		}
		remotes = append(remotes, Remote{Name: name, URL: RedactRemoteURL(raw)})
	}
	return remotes, nil
}

// RedactRemoteURL removes any embedded credentials from a remote URL while
// keeping it recognisable. A non-URL (scp-style `git@host:org/repo`, or a
// filesystem path) has no userinfo component and is returned unchanged.
func RedactRemoteURL(raw string) string {
	raw = strings.TrimSpace(raw)
	parsed, err := url.Parse(raw)
	if err != nil || parsed.User == nil {
		return raw
	}
	if _, hasPassword := parsed.User.Password(); !hasPassword && parsed.User.Username() == "" {
		return raw
	}
	// The marker is spliced in textually rather than through url.User, which
	// percent-encodes it into an unreadable `%2A%2A%2A`. Dropping the userinfo
	// first guarantees no fragment of the real credential survives.
	parsed.User = nil
	return strings.Replace(parsed.String(), "://", "://***@", 1)
}

// CurrentBranch reports the checked-out branch, empty when HEAD is detached.
func CurrentBranch(ctx context.Context, root string) string {
	branch, err := run(ctx, root, "symbolic-ref", "--quiet", "--short", "HEAD")
	if err != nil {
		return ""
	}
	return branch
}
