package app

import (
	"context"
	"net/url"
	"path"
	"sort"
	"strings"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/hostrepo"
)

func buildRequestGitRepositoryContext(ctx context.Context, root string, manifest domain.ContextManifest, kind, name, namespace string, commitLimit int) requestGitRepositoryContext {
	repository := requestGitRepositoryContext{State: "unavailable", Kind: kind, Name: name, Namespace: namespace, Files: []RequestGitContextFile{}}
	branches, err := hostrepo.Branches(ctx, root)
	if err != nil {
		repository.Index = unavailableRequestGitRepositoryIndex(repository)
		return repository
	}
	active, hasBranch := currentLocalBranch(branches)
	if hasBranch {
		repository.Ref = active.Name
		repository.Upstream = active.Upstream
		repository.HasUpstream = active.HasUpstream && !active.Gone
		repository.Ahead, repository.Behind = active.Ahead, active.Behind
	}
	if head, ok := hostrepo.HeadSHA(ctx, root); ok {
		repository.HeadSHA = head
	}
	if repository.Ref == "" {
		if repository.HeadSHA == "" {
			repository.Ref = "unborn"
		} else {
			repository.Ref = "detached@" + repository.HeadSHA[:12]
		}
	}
	if repository.Namespace == "" {
		repository.Namespace = repository.Ref
	}
	repository.RefPath = "git-context/" + gitContextRefSegment(repository.Namespace) + "/"
	allowed := requestGitAllowedPaths(manifest)
	working, err := hostrepo.Working(ctx, root)
	if err != nil {
		repository.Index = unavailableRequestGitRepositoryIndex(repository)
		return repository
	}
	candidates := append(append(append([]string{}, working.Stageable...), working.GitlinkChanges...), working.Unmerged...)
	changed, omittedWorking := filterGitContextPaths(candidates, allowed, requestGitWorktreePathLimit)
	worktreeDiff, worktreeTruncated := "", false
	if len(changed) > 0 {
		worktreeDiff, worktreeTruncated, err = hostrepo.WorktreeDiff(ctx, root, changed, requestGitWorktreeDiffLimit)
		if err != nil {
			repository.Index = unavailableRequestGitRepositoryIndex(repository)
			return repository
		}
	}
	worktreePath := repository.RefPath + "uncommited/diff"
	worktreeStatePath := repository.RefPath + "uncommited/state.json"
	repository.Files = append(repository.Files, requestGitTextFile(worktreePath, worktreeDiff))
	worktreeState := map[string]any{
		"protocol": "harness.git-context-worktree/v1", "ref": repository.Ref, "diff": worktreePath,
		"files": changed, "omitted_file_count": omittedWorking, "diff_truncated": worktreeTruncated,
		"dirty_submodule_count": len(working.DirtySubmodules), "embedded_repository_count": len(working.EmbeddedRepositories), "unmerged_count": len(working.Unmerged),
	}
	repository.Files = append(repository.Files, requestGitJSONFile(worktreeStatePath, worktreeState))

	commits, err := hostrepo.Unpushed(ctx, root, commitLimit)
	if err != nil {
		repository.Files = nil
		repository.Index = unavailableRequestGitRepositoryIndex(repository)
		return repository
	}
	commitIndex := make([]map[string]any, 0, len(commits))
	for _, commit := range commits {
		paths, pathsErr := hostrepo.CommitChangedPaths(ctx, root, commit.SHA)
		if pathsErr != nil {
			repository.Files = nil
			repository.Index = unavailableRequestGitRepositoryIndex(repository)
			return repository
		}
		included, omitted := filterGitContextPaths(paths, allowed, requestGitCommitPathLimit)
		diff, truncated, diffErr := hostrepo.CommitDiffPaths(ctx, root, commit.SHA, included, requestGitCommitDiffLimit)
		if diffErr != nil {
			repository.Files = nil
			repository.Index = unavailableRequestGitRepositoryIndex(repository)
			return repository
		}
		prefix := repository.RefPath + commit.SHA + "/"
		diffPath := prefix + "diff"
		commitPath := prefix + "commit.json"
		repository.Files = append(repository.Files, requestGitTextFile(diffPath, diff))
		subject, subjectTruncated := truncateRequestGitText(commit.Subject, 8<<10)
		body, bodyTruncated := truncateRequestGitText(commit.Body, requestGitCommitBodyLimit)
		authorName, _ := truncateRequestGitText(commit.AuthorName, 4<<10)
		authorEmail, _ := truncateRequestGitText(commit.AuthorEmail, 4<<10)
		meta := map[string]any{
			"protocol": "harness.git-context-commit/v1", "sha": commit.SHA, "short_sha": commit.ShortSHA,
			"subject": subject, "body": body, "author_name": authorName, "author_email": authorEmail,
			"subject_truncated": subjectTruncated, "body_truncated": bodyTruncated,
			"committed_at": commit.CommittedAt, "parents": commit.Parents, "request_id": commit.RequestID, "plan_id": commit.PlanID,
			"wharnex": commit.Wharnex, "merge": commit.Merge, "pushed": commit.Pushed, "files": included,
			"omitted_file_count": omitted, "diff": diffPath, "diff_truncated": truncated,
		}
		repository.Files = append(repository.Files, requestGitJSONFile(commitPath, meta))
		commitIndex = append(commitIndex, map[string]any{"sha": commit.SHA, "subject": subject, "path": prefix, "file_count": len(included), "omitted_file_count": omitted, "diff_truncated": truncated})
	}
	repository.State = "present"
	repository.Index = map[string]any{
		"state": "present", "kind": repository.Kind, "name": repository.Name, "namespace": repository.Namespace,
		"ref": repository.Ref, "ref_path": repository.RefPath, "head_sha": repository.HeadSHA,
		"upstream": repository.Upstream, "has_upstream": repository.HasUpstream, "ahead": repository.Ahead, "behind": repository.Behind,
		"uncommited":             map[string]any{"path": repository.RefPath + "uncommited/", "diff": worktreePath, "state": worktreeStatePath},
		"local_unpushed_commits": commitIndex, "commit_limit": commitLimit,
	}
	return repository
}

func unavailableRequestGitRepositoryIndex(repository requestGitRepositoryContext) map[string]any {
	return map[string]any{
		"state": "unavailable", "kind": repository.Kind, "name": repository.Name,
		"namespace": repository.Namespace, "ref": repository.Ref, "ref_path": repository.RefPath,
		"reason": "git repository context is unavailable",
	}
}

func requestGitCommitLimitForRepositories(repositories int) int {
	if repositories < 1 {
		repositories = 1
	}
	limit := (requestGitMaxFiles - 1 - (2 * repositories)) / (2 * repositories)
	if limit < 1 {
		return 1
	}
	if limit > requestGitCommitLimit {
		return requestGitCommitLimit
	}
	return limit
}

func relatedGitContextNamespace(project domain.RelatedProjectContext) string {
	prefix := strings.Trim(strings.TrimSpace(project.Prefix), "/")
	segment := path.Base(prefix)
	if segment == "." || segment == "" {
		segment = project.Name
	}
	return "related-" + segment
}

func requestGitAllowedPaths(manifest domain.ContextManifest) map[string]struct{} {
	allowed := make(map[string]struct{}, len(manifest.Files))
	for _, file := range manifest.Files {
		filePath := strings.TrimPrefix(file.Path, "./")
		if filePath != "" {
			allowed[filePath] = struct{}{}
		}
	}
	return allowed
}

func filterGitContextPaths(paths []string, allowed map[string]struct{}, limit int) ([]string, int) {
	seen := map[string]struct{}{}
	included := make([]string, 0, len(paths))
	omitted := 0
	for _, raw := range paths {
		filePath := strings.TrimPrefix(raw, "./")
		if filePath == "" {
			continue
		}
		if _, exists := seen[filePath]; exists {
			continue
		}
		seen[filePath] = struct{}{}
		if _, ok := allowed[filePath]; !ok {
			omitted++
			continue
		}
		included = append(included, filePath)
	}
	sort.Strings(included)
	if limit > 0 && len(included) > limit {
		omitted += len(included) - limit
		included = included[:limit]
	}
	return included, omitted
}

func truncateRequestGitText(value string, limit int) (string, bool) {
	if limit <= 0 || len(value) <= limit {
		return value, false
	}
	return value[:limit], true
}

func gitContextRefSegment(ref string) string {
	return url.PathEscape(strings.TrimSpace(ref))
}
