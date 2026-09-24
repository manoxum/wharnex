package app

import (
	"context"
	"fmt"
	"strings"

	"kernl.local/harness/backend/internal/hostrepo"
)

const gitPreviewLimit = 2 << 20

// GitPreviewRequest describes the exact Git state an operator is about to
// mutate. Preview is read-only except for refreshing remote-tracking refs for
// push/pull, so the confirmation modal compares against current remote state.
type GitPreviewRequest struct {
	Operation      string   `json:"operation"`
	Repository     string   `json:"repository"`
	Paths          []string `json:"paths,omitempty"`
	PendingIDs     []string `json:"pending_ids,omitempty"`
	Remote         string   `json:"remote,omitempty"`
	Branch         string   `json:"branch,omitempty"`
	Ref            string   `json:"ref,omitempty"`
	BaseRef        string   `json:"base_ref,omitempty"`
	RefreshRemotes []string `json:"refresh_remotes,omitempty"`
	CommitSHAs     []string `json:"commit_shas,omitempty"`
}

type GitOperationPreview struct {
	Operation  string `json:"operation"`
	Repository string `json:"repository"`
	FromLabel  string `json:"from_label"`
	ToLabel    string `json:"to_label"`
	FromSHA    string `json:"from_sha,omitempty"`
	ToSHA      string `json:"to_sha,omitempty"`
	Diff       string `json:"diff"`
	Truncated  bool   `json:"truncated,omitempty"`
}

func (s *Service) PreviewGitOperation(ctx context.Context, sessionID string, req GitPreviewRequest) (GitOperationPreview, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return GitOperationPreview{}, err
	}
	lock := s.projectApplyLock(item.ProjectPath)
	lock.Lock()
	defer lock.Unlock()
	ctx = WithGitRepository(ctx, req.Repository)
	root, repoPath, _, err := s.gitRepositoryRoot(ctx, item.ProjectPath)
	if err != nil {
		return GitOperationPreview{}, err
	}
	preview := GitOperationPreview{Operation: req.Operation, Repository: repoPath}

	switch strings.TrimSpace(req.Operation) {
	case "commit":
		paths, pathErr := s.previewCommitPaths(ctx, item.ProjectPath, root, req)
		if pathErr != nil {
			return preview, pathErr
		}
		preview.FromLabel, preview.ToLabel = "HEAD", "Worktree"
		preview.FromSHA, _, _ = hostrepo.ResolveRef(ctx, root, "HEAD")
		preview.Diff, preview.Truncated, err = hostrepo.WorktreeDiff(ctx, root, paths, gitPreviewLimit)
	case "push":
		remote, branch := strings.TrimSpace(req.Remote), strings.TrimSpace(req.Branch)
		if remote == "" || branch == "" {
			return preview, fmt.Errorf("remote and branch are required for push preview")
		}
		if err = gitRemoteFetch(ctx, root, remote); err != nil {
			return preview, err
		}
		target := branch
		if len(req.CommitSHAs) > 0 {
			target = strings.TrimSpace(req.CommitSHAs[len(req.CommitSHAs)-1])
		}
		tracking := remote + "/" + branch
		preview.FromLabel, preview.ToLabel = tracking, target
		var exists bool
		var resolveErr error
		preview.FromSHA, exists, resolveErr = hostrepo.ResolveRef(ctx, root, tracking)
		if resolveErr != nil {
			return preview, resolveErr
		}
		preview.ToSHA, _, _ = hostrepo.ResolveRef(ctx, root, target)
		if exists {
			preview.Diff, preview.Truncated, err = hostrepo.DiffBetween(ctx, root, tracking, target, gitPreviewLimit)
		} else {
			preview.FromLabel = tracking + " (nova branch)"
			preview.Diff, preview.Truncated, err = hostrepo.DiffFromEmpty(ctx, root, target, gitPreviewLimit)
		}
	case "pull":
		remote, branch := strings.TrimSpace(req.Remote), strings.TrimSpace(req.Branch)
		if remote == "" || branch == "" {
			return preview, fmt.Errorf("remote and branch are required for pull preview")
		}
		if err = gitRemoteFetch(ctx, root, remote); err != nil {
			return preview, err
		}
		tracking := remote + "/" + branch
		if _, exists, _ := hostrepo.ResolveRef(ctx, root, tracking); !exists {
			return preview, fmt.Errorf("remote branch %s does not exist", tracking)
		}
		preview.FromLabel, preview.ToLabel = branch, tracking
		preview.FromSHA, _, _ = hostrepo.ResolveRef(ctx, root, "HEAD")
		preview.ToSHA, _, _ = hostrepo.ResolveRef(ctx, root, tracking)
		preview.Diff, preview.Truncated, err = hostrepo.DiffBetween(ctx, root, "HEAD", tracking, gitPreviewLimit)
	case "merge":
		ref := strings.TrimSpace(req.Ref)
		if ref == "" {
			return preview, fmt.Errorf("merge ref is required")
		}
		seenRemotes := map[string]bool{}
		for _, rawRemote := range req.RefreshRemotes {
			remote := strings.TrimSpace(rawRemote)
			if remote == "" || seenRemotes[remote] {
				continue
			}
			seenRemotes[remote] = true
			if err = gitRemoteFetch(ctx, root, remote); err != nil {
				return preview, err
			}
		}
		base := strings.TrimSpace(req.BaseRef)
		if base == "" {
			base = "HEAD"
		}
		if _, exists, _ := hostrepo.ResolveRef(ctx, root, base); !exists {
			return preview, fmt.Errorf("merge base %s does not exist", base)
		}
		if _, exists, _ := hostrepo.ResolveRef(ctx, root, ref); !exists {
			return preview, fmt.Errorf("merge ref %s does not exist", ref)
		}
		preview.FromLabel, preview.ToLabel = base, ref
		preview.FromSHA, _, _ = hostrepo.ResolveRef(ctx, root, base)
		preview.ToSHA, _, _ = hostrepo.ResolveRef(ctx, root, ref)
		preview.Diff, preview.Truncated, err = hostrepo.DiffBetween(ctx, root, base, ref, gitPreviewLimit)
	default:
		return preview, fmt.Errorf("unsupported git preview operation %q", req.Operation)
	}
	if err != nil {
		return preview, err
	}
	return preview, nil
}
