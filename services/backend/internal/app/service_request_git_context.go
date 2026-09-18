package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"sort"

	"kernl.local/harness/backend/internal/domain"
)

const (
	requestGitContextProtocol   = "harness.git-context/v1"
	requestGitCommitLimit       = 50
	requestGitMaxFiles          = 128
	requestGitCommitDiffLimit   = 192 << 10
	requestGitWorktreeDiffLimit = 512 << 10
	requestGitWorktreePathLimit = 128
	requestGitCommitPathLimit   = 32
	requestGitCommitBodyLimit   = 64 << 10
)

type RequestGitContextFile struct {
	Path    string `json:"path"`
	SHA256  string `json:"sha256"`
	Bytes   int64  `json:"bytes"`
	Content string `json:"content"`
}

type RequestGitContext struct {
	Protocol    string                  `json:"protocol"`
	State       string                  `json:"state"`
	Root        string                  `json:"root"`
	Index       string                  `json:"index"`
	Ref         string                  `json:"ref,omitempty"`
	RefPath     string                  `json:"ref_path,omitempty"`
	HeadSHA     string                  `json:"head_sha,omitempty"`
	Upstream    string                  `json:"upstream,omitempty"`
	HasUpstream bool                    `json:"has_upstream"`
	Ahead       int                     `json:"ahead"`
	Behind      int                     `json:"behind"`
	Files       []RequestGitContextFile `json:"files"`
}

type requestGitRepositoryContext struct {
	State       string
	Kind        string
	Name        string
	Namespace   string
	Ref         string
	RefPath     string
	HeadSHA     string
	Upstream    string
	HasUpstream bool
	Ahead       int
	Behind      int
	Files       []RequestGitContextFile
	Index       map[string]any
}

func (s *Service) RequestGitContext(ctx context.Context, sessionID string) (RequestGitContext, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return RequestGitContext{}, err
	}
	return requestGitContextForItem(ctx, item), nil
}

func requestGitContextForItem(ctx context.Context, item domain.Session) RequestGitContext {
	result := RequestGitContext{
		Protocol: requestGitContextProtocol,
		State:    "unavailable",
		Root:     "git-context/",
		Index:    "git-context/index.json",
		Files:    []RequestGitContextFile{},
	}
	related := append([]domain.RelatedProjectContext(nil), item.Context.RelatedProjects...)
	sort.Slice(related, func(i, j int) bool { return related[i].Prefix < related[j].Prefix })
	commitLimit := requestGitCommitLimitForRepositories(1 + len(related))

	repositories := make([]requestGitRepositoryContext, 0, 1+len(related))
	primary := buildRequestGitRepositoryContext(ctx, item.ProjectPath, item.Context.Manifest, "primary", "primary", "", commitLimit)
	repositories = append(repositories, primary)
	result.Ref, result.RefPath = primary.Ref, primary.RefPath
	result.HeadSHA, result.Upstream = primary.HeadSHA, primary.Upstream
	result.HasUpstream, result.Ahead, result.Behind = primary.HasUpstream, primary.Ahead, primary.Behind
	for _, companion := range related {
		repositories = append(repositories, buildRequestGitRepositoryContext(
			ctx, companion.ProjectPath, companion.Manifest, "related", companion.Name,
			relatedGitContextNamespace(companion), commitLimit,
		))
	}

	repositoryIndex := make([]map[string]any, 0, len(repositories))
	present := 0
	for _, repository := range repositories {
		if repository.State == "present" {
			present++
		}
		result.Files = append(result.Files, repository.Files...)
		repositoryIndex = append(repositoryIndex, repository.Index)
	}
	if present > 0 {
		result.State = "present"
	}
	index := map[string]any{
		"protocol": requestGitContextProtocol, "state": result.State,
		"root": result.Root, "primary_ref": result.Ref, "primary_ref_path": result.RefPath,
		"repositories": repositoryIndex,
		"filtering":    "Only paths admitted by each repository's current request context manifest are serialized; excluded or secret-like paths are omitted from Git diffs.",
	}
	result.Files = append([]RequestGitContextFile{requestGitJSONFile(result.Index, index)}, result.Files...)
	return result
}

func requestGitJSONFile(path string, value any) RequestGitContextFile {
	raw, _ := json.MarshalIndent(value, "", "  ")
	raw = append(raw, '\n')
	return requestGitBytesFile(path, raw)
}

func requestGitTextFile(path, content string) RequestGitContextFile {
	return requestGitBytesFile(path, []byte(content))
}

func requestGitBytesFile(path string, raw []byte) RequestGitContextFile {
	digest := sha256.Sum256(raw)
	return RequestGitContextFile{Path: path, SHA256: hex.EncodeToString(digest[:]), Bytes: int64(len(raw)), Content: string(raw)}
}

func requestGitContextManifest(snapshot RequestGitContext) map[string]any {
	files := make([]map[string]any, 0, len(snapshot.Files))
	for _, file := range snapshot.Files {
		files = append(files, map[string]any{"path": file.Path, "sha256": file.SHA256, "bytes": file.Bytes})
	}
	return map[string]any{"protocol": snapshot.Protocol, "state": snapshot.State, "root": snapshot.Root, "index": snapshot.Index, "ref": snapshot.Ref, "ref_path": snapshot.RefPath, "head_sha": snapshot.HeadSHA, "upstream": snapshot.Upstream, "has_upstream": snapshot.HasUpstream, "ahead": snapshot.Ahead, "behind": snapshot.Behind, "files": files}
}
