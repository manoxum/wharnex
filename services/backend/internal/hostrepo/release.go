package hostrepo

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
)

// Tag is a local release marker shown by the Git surface. CreatedAt is Git's
// creator date in RFC3339-like ISO form (tagger date for annotated tags and
// commit date for lightweight tags).
type Tag struct {
	Name      string `json:"name"`
	CommitSHA string `json:"commit_sha"`
	CreatedAt string `json:"created_at,omitempty"`
}

// Tags lists the newest local tags without consulting a remote API. A release
// created by Wharnex always creates its tag locally first, so this remains a
// fast, durable inventory even when GitHub is temporarily unavailable.
func Tags(ctx context.Context, root string, limit int) ([]Tag, error) {
	if limit <= 0 {
		limit = 50
	}
	const format = "%(refname:short)%09%(*objectname)%09%(objectname)%09%(creatordate:iso8601-strict)"
	output, err := run(ctx, root, "for-each-ref", "--sort=-creatordate", "--count="+strconv.Itoa(limit), "--format="+format, "refs/tags")
	if err != nil {
		return nil, fmt.Errorf("list tags: %s", strings.TrimSpace(output))
	}
	tags := make([]Tag, 0)
	for _, line := range strings.Split(output, "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		fields := strings.SplitN(line, "\t", 4)
		if len(fields) < 3 {
			continue
		}
		sha := strings.TrimSpace(fields[1])
		if sha == "" {
			sha = strings.TrimSpace(fields[2])
		}
		tag := Tag{Name: strings.TrimSpace(fields[0]), CommitSHA: sha}
		if len(fields) == 4 {
			tag.CreatedAt = strings.TrimSpace(fields[3])
		}
		if tag.Name != "" && tag.CommitSHA != "" {
			tags = append(tags, tag)
		}
	}
	return tags, nil
}

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
