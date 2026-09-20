package hostrepo

import (
	"context"
	"errors"
	"fmt"
	"strings"
)

// CreateTagAtRef creates a lightweight tag at the selected branch/ref. A retry
// is idempotent when the tag already points at the same commit, but refuses to
// move an existing tag because rewriting published release history is unsafe.
func CreateTagAtRef(ctx context.Context, root, tag, ref string) (string, error) {
	tag = strings.TrimSpace(tag)
	ref = strings.TrimSpace(ref)
	if tag == "" || strings.HasPrefix(tag, "-") {
		return "", errors.New("a valid tag name is required")
	}
	if ref == "" || strings.HasPrefix(ref, "-") {
		return "", errors.New("a branch or ref is required for the tag")
	}
	if output, err := run(ctx, root, "check-ref-format", "refs/tags/"+tag); err != nil {
		return "", fmt.Errorf("invalid tag name %s: %s", tag, strings.TrimSpace(output))
	}
	sha, err := run(ctx, root, "rev-parse", "--verify", ref+"^{commit}")
	if err != nil {
		return "", fmt.Errorf("resolve release branch %s: %s", ref, RedactRemoteURL(sha))
	}
	sha = strings.TrimSpace(sha)
	if existing, existingErr := run(ctx, root, "rev-parse", "--verify", "--quiet", "refs/tags/"+tag+"^{commit}"); existingErr == nil {
		if strings.TrimSpace(existing) == sha {
			return sha, nil
		}
		return "", fmt.Errorf("tag %s already exists at a different commit", tag)
	}
	if output, err := run(ctx, root, "tag", tag, sha); err != nil {
		return "", fmt.Errorf("create tag %s: %s", tag, RedactRemoteURL(output))
	}
	return sha, nil
}
