package hostrepo

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
)

// ResolveRef returns the commit SHA behind a trusted Git ref. A missing ref is
// reported as exists=false so callers can distinguish a new remote branch from
// a broken comparison.
func ResolveRef(ctx context.Context, root, ref string) (sha string, exists bool, err error) {
	ref = strings.TrimSpace(ref)
	if ref == "" || strings.HasPrefix(ref, "-") {
		return "", false, fmt.Errorf("invalid git ref %q", ref)
	}
	output, runErr := run(ctx, root, "rev-parse", "--verify", ref+"^{commit}")
	if runErr != nil {
		return "", false, nil
	}
	return strings.TrimSpace(output), true, nil
}

// DiffFromEmpty compares a commit tree to Git's empty tree. It is used when a
// push will create a remote branch that does not exist yet.
func DiffFromEmpty(ctx context.Context, root, toRef string, limitBytes int) (diff string, truncated bool, err error) {
	toRef = strings.TrimSpace(toRef)
	if toRef == "" || strings.HasPrefix(toRef, "-") {
		return "", false, fmt.Errorf("invalid git ref %q", toRef)
	}
	emptyTree, err := emptyTreeSHA(ctx, root)
	if err != nil {
		return "", false, err
	}
	return DiffBetween(ctx, root, emptyTree, toRef, limitBytes)
}

func emptyTreeSHA(ctx context.Context, root string) (string, error) {
	if _, err := exec.LookPath("git"); err != nil {
		return "", ErrGitUnavailable
	}
	cmd := exec.CommandContext(ctx, "git", "-C", root, "hash-object", "-t", "tree", "--stdin")
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	cmd.Stdin = strings.NewReader("")
	output, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("resolve empty git tree: %w", err)
	}
	sha := strings.TrimSpace(string(output))
	if sha == "" {
		return "", fmt.Errorf("resolve empty git tree: empty result")
	}
	return sha, nil
}
