package hostrepo

import (
	"context"
	"strings"
)

// IsAncestor reports whether ancestor is reachable from descendant. Any
// unknown commit or ref reads as false, so callers degrade to "not contained".
func IsAncestor(ctx context.Context, root, ancestor, descendant string) bool {
	ancestor, descendant = strings.TrimSpace(ancestor), strings.TrimSpace(descendant)
	if ancestor == "" || descendant == "" {
		return false
	}
	_, err := run(ctx, root, "merge-base", "--is-ancestor", ancestor, descendant)
	return err == nil
}
