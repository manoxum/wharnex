package httpapi

import (
	"net/http"
	"strconv"
	"strings"

	"kernl.local/harness/backend/internal/gitsettings"
)

// registerGitRoutes mounts the project Git surface.
//
// Every mutating route here is an explicit human action taken from the trusted
// local frontend: committing, pushing and merging are never reachable from a
// model plan, which continues to go through Policy and Protected execution.
// That separation is the whole reason these live on their own routes rather
// than becoming plan operations.
func (a *API) registerGitRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/sessions/{id}/git/overview", a.gitOverview)
	mux.HandleFunc("GET /api/sessions/{id}/git/head", a.gitHead)
	mux.HandleFunc("GET /api/sessions/{id}/git/context", a.gitRequestContext)
	mux.HandleFunc("GET /api/sessions/{id}/git/diff", a.gitFileDiff)
	mux.HandleFunc("GET /api/sessions/{id}/git/history", a.gitHistory)
	mux.HandleFunc("GET /api/sessions/{id}/git/contributors", a.gitContributors)
	mux.HandleFunc("GET /api/sessions/{id}/git/history/page", a.gitHistoryPage)
	mux.HandleFunc("GET /api/sessions/{id}/git/history/{sha}", a.gitHistoryCommit)
	mux.HandleFunc("GET /api/sessions/{id}/git/merge-candidates", a.gitMergeCandidates)
	mux.HandleFunc("GET /api/sessions/{id}/git/unpushed", a.gitUnpushed)
	mux.HandleFunc("GET /api/sessions/{id}/git/unpushed/{sha}", a.gitUnpushedCommit)
	mux.HandleFunc("PUT /api/sessions/{id}/git/commit-mode", a.setGitCommitMode)
	mux.HandleFunc("PUT /api/sessions/{id}/git/conflict-strategy", a.setGitConflictStrategy)
	mux.HandleFunc("PUT /api/sessions/{id}/git/author-settings", a.setGitAuthorSettings)
	mux.HandleFunc("GET /api/sessions/{id}/git/pending/{pending_id}", a.gitPendingCommit)
	mux.HandleFunc("POST /api/sessions/{id}/git/pending/commit", a.commitGitPending)
	mux.HandleFunc("POST /api/sessions/{id}/git/worktree/commit", a.commitGitWorktree)
	mux.HandleFunc("POST /api/sessions/{id}/git/pending/discard", a.discardGitPending)
	mux.HandleFunc("POST /api/sessions/{id}/git/push", a.gitPush)
	mux.HandleFunc("POST /api/sessions/{id}/git/push-selected", a.gitPushSelected)
	mux.HandleFunc("POST /api/sessions/{id}/git/fetch", a.gitFetch)
	mux.HandleFunc("POST /api/sessions/{id}/git/pull", a.gitPull)
	mux.HandleFunc("POST /api/sessions/{id}/git/switch", a.gitSwitch)
	mux.HandleFunc("POST /api/sessions/{id}/git/branches", a.gitCreateBranch)
	mux.HandleFunc("POST /api/sessions/{id}/git/branches/delete", a.gitDeleteBranch)
	mux.HandleFunc("POST /api/sessions/{id}/git/release-notes", a.gitReleaseNotes)
	mux.HandleFunc("POST /api/sessions/{id}/git/releases", a.gitCreateRelease)
	mux.HandleFunc("POST /api/sessions/{id}/git/merge", a.gitMerge)
	mux.HandleFunc("POST /api/sessions/{id}/git/remote-merge", a.gitRemoteMerge)
}

func (a *API) gitOverview(w http.ResponseWriter, r *http.Request) {
	overview, err := a.service.GitOverview(r.Context(), r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusNotFound, "session_not_found", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, overview)
}

func (a *API) gitHead(w http.ResponseWriter, r *http.Request) {
	head, err := a.service.GitHead(r.Context(), r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusNotFound, "session_not_found", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, head)
}

func (a *API) gitRequestContext(w http.ResponseWriter, r *http.Request) {
	snapshot, err := a.service.RequestGitContext(r.Context(), r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusNotFound, "session_not_found", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, snapshot)
}

func (a *API) gitHistory(w http.ResponseWriter, r *http.Request) {
	all := strings.EqualFold(strings.TrimSpace(r.URL.Query().Get("all")), "true")
	commits, err := a.service.GitHistory(r.Context(), r.PathValue("id"), r.URL.Query()["ref"], all)
	if err != nil {
		writeError(w, http.StatusBadRequest, "git_history_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, commits)
}

func (a *API) gitContributors(w http.ResponseWriter, r *http.Request) {
	overview, err := a.service.GitContributors(r.Context(), r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "git_contributors_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, overview)
}

func (a *API) gitHistoryPage(w http.ResponseWriter, r *http.Request) {
	all := strings.EqualFold(strings.TrimSpace(r.URL.Query().Get("all")), "true")
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	page, err := a.service.GitHistoryPage(r.Context(), r.PathValue("id"), r.URL.Query()["ref"], all, limit, offset)
	if err != nil {
		writeError(w, http.StatusBadRequest, "git_history_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, page)
}

func (a *API) gitHistoryCommit(w http.ResponseWriter, r *http.Request) {
	detail, err := a.service.GitHistoryCommit(r.Context(), r.PathValue("id"), r.PathValue("sha"))
	if err != nil {
		writeError(w, http.StatusNotFound, "git_history_commit_not_found", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, detail)
}

func (a *API) gitMergeCandidates(w http.ResponseWriter, r *http.Request) {
	branches, err := a.service.GitMergeCandidates(r.Context(), r.PathValue("id"), r.URL.Query().Get("target"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "git_merge_candidates_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, branches)
}

func (a *API) gitUnpushed(w http.ResponseWriter, r *http.Request) {
	overview, err := a.service.GitUnpushed(r.Context(), r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "git_unpushed_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, overview)
}

func (a *API) gitUnpushedCommit(w http.ResponseWriter, r *http.Request) {
	detail, err := a.service.GitUnpushedCommit(r.Context(), r.PathValue("id"), r.PathValue("sha"))
	if err != nil {
		writeError(w, http.StatusNotFound, "git_unpushed_commit_not_found", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, detail)
}

func (a *API) gitFileDiff(w http.ResponseWriter, r *http.Request) {
	diff, err := a.service.GitFileDiff(r.Context(), r.PathValue("id"), r.URL.Query().Get("path"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "git_diff_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, diff)
}

func (a *API) setGitCommitMode(w http.ResponseWriter, r *http.Request) {
	var body struct {
		CommitMode string `json:"commit_mode"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	item, err := a.service.GetSession(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusNotFound, "session_not_found", err.Error())
		return
	}
	mode, err := a.service.SetGitCommitMode(item.ProjectPath, gitsettings.CommitMode(strings.TrimSpace(body.CommitMode)))
	if err != nil {
		writeError(w, http.StatusBadRequest, "git_commit_mode_invalid", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"commit_mode": string(mode)})
}

func (a *API) setGitConflictStrategy(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ConflictStrategy string `json:"conflict_strategy"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	item, err := a.service.GetSession(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusNotFound, "session_not_found", err.Error())
		return
	}
	strategy, err := a.service.SetGitConflictStrategy(item.ProjectPath, gitsettings.ConflictStrategy(strings.TrimSpace(body.ConflictStrategy)))
	if err != nil {
		writeError(w, http.StatusBadRequest, "git_conflict_strategy_invalid", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"conflict_strategy": string(strategy)})
}

func (a *API) setGitAuthorSettings(w http.ResponseWriter, r *http.Request) {
	var body gitsettings.GlobalSettings
	if !decodeJSON(w, r, &body) {
		return
	}
	settings, err := a.service.SetGitAuthorSettings(body)
	if err != nil {
		writeError(w, http.StatusBadRequest, "git_author_settings_invalid", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, settings)
}

func (a *API) gitPendingCommit(w http.ResponseWriter, r *http.Request) {
	record, err := a.service.PendingCommitDiff(r.PathValue("id"), r.PathValue("pending_id"))
	if err != nil {
		writeError(w, http.StatusNotFound, "pending_commit_not_found", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, record)
}

func (a *API) commitGitPending(w http.ResponseWriter, r *http.Request) {
	var body struct {
		PendingIDs []string `json:"pending_ids"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	result, err := a.service.CommitPending(r.Context(), r.PathValue("id"), body.PendingIDs)
	if err != nil {
		// A blocked selection is the operator's to widen, not a server fault:
		// it carries the records they need to include.
		writeJSONError(w, http.StatusConflict, "git_commit_blocked", err.Error(), result)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (a *API) commitGitWorktree(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Message string   `json:"message"`
		Paths   []string `json:"paths"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	result, err := a.service.CommitWorkingFiles(r.Context(), r.PathValue("id"), body.Message, body.Paths)
	if err != nil {
		writeError(w, http.StatusBadRequest, "git_worktree_commit_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (a *API) discardGitPending(w http.ResponseWriter, r *http.Request) {
	var body struct {
		PendingIDs []string `json:"pending_ids"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	removed, err := a.service.DiscardPending(r.PathValue("id"), body.PendingIDs)
	if err != nil {
		writeError(w, http.StatusBadRequest, "git_pending_discard_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"removed": removed})
}

func (a *API) gitPush(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Remote       string `json:"remote"`
		Branch       string `json:"branch"`
		SetUpstream  bool   `json:"set_upstream"`
		Confirmation string `json:"confirmation"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	// Pushing publishes code to a remote other people read, which is the one
	// action on this surface that reaches outside the operator's machine and
	// cannot be undone by a local reset. The explicit confirmation token makes
	// it impossible to trigger by a stray click or a replayed request.
	if strings.TrimSpace(body.Confirmation) != "push" {
		writeError(w, http.StatusBadRequest, "git_push_unconfirmed", "pushing to a remote requires an explicit confirmation")
		return
	}
	result, err := a.service.PushBranch(r.Context(), r.PathValue("id"), body.Remote, body.Branch, body.SetUpstream)
	if err != nil {
		writeError(w, http.StatusBadRequest, "git_push_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (a *API) gitPushSelected(w http.ResponseWriter, r *http.Request) {
	var body struct {
		CommitSHAs   []string `json:"commit_shas"`
		Confirmation string   `json:"confirmation"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if strings.TrimSpace(body.Confirmation) != "push" {
		writeError(w, http.StatusBadRequest, "git_push_unconfirmed", "pushing to a remote requires an explicit confirmation")
		return
	}
	result, err := a.service.PushSelectedCommits(r.Context(), r.PathValue("id"), body.CommitSHAs)
	if err != nil {
		writeError(w, http.StatusBadRequest, "git_push_selected_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (a *API) gitFetch(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Remote string `json:"remote"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	result, err := a.service.FetchRemote(r.Context(), r.PathValue("id"), body.Remote)
	if err != nil {
		writeError(w, http.StatusBadRequest, "git_fetch_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (a *API) gitPull(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Remote string `json:"remote"`
		Branch string `json:"branch"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	result, err := a.service.PullBranch(r.Context(), r.PathValue("id"), body.Remote, body.Branch)
	if err != nil {
		writeError(w, http.StatusBadRequest, "git_pull_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (a *API) gitSwitch(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Branch string `json:"branch"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	result, err := a.service.SwitchBranch(r.Context(), r.PathValue("id"), body.Branch)
	if err != nil {
		writeError(w, http.StatusBadRequest, "git_switch_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (a *API) gitCreateBranch(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Branch     string `json:"branch"`
		StartPoint string `json:"start_point"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	result, err := a.service.CreateBranch(r.Context(), r.PathValue("id"), body.Branch, body.StartPoint)
	if err != nil {
		writeError(w, http.StatusBadRequest, "git_branch_create_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (a *API) gitDeleteBranch(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Branch       string `json:"branch"`
		Confirmation string `json:"confirmation"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if strings.TrimSpace(body.Confirmation) != "delete_branch" {
		writeError(w, http.StatusBadRequest, "git_branch_delete_unconfirmed", "branch deletion requires an explicit confirmation")
		return
	}
	result, err := a.service.DeleteBranch(r.Context(), r.PathValue("id"), body.Branch)
	if err != nil {
		writeError(w, http.StatusBadRequest, "git_branch_delete_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (a *API) gitReleaseNotes(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Branch string `json:"branch"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	result, err := a.service.GenerateGitReleaseNotes(r.Context(), r.PathValue("id"), body.Branch)
	if err != nil {
		writeError(w, http.StatusBadRequest, "git_release_notes_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (a *API) gitCreateRelease(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Branch       string `json:"branch"`
		TagSuffix    string `json:"tag_suffix"`
		Title        string `json:"title"`
		Body         string `json:"body"`
		Confirmation string `json:"confirmation"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if strings.TrimSpace(body.Confirmation) != "publish_release" {
		writeError(w, http.StatusBadRequest, "git_release_unconfirmed", "publishing a tag and GitHub release requires an explicit confirmation")
		return
	}
	result, err := a.service.CreateGitRelease(r.Context(), r.PathValue("id"), body.Branch, body.TagSuffix, body.Title, body.Body)
	if err != nil {
		writeError(w, http.StatusBadRequest, "git_release_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (a *API) gitMerge(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Ref string `json:"ref"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	result, err := a.service.MergeBranchIntoCurrent(r.Context(), r.PathValue("id"), body.Ref)
	if err != nil {
		writeError(w, http.StatusBadRequest, "git_merge_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (a *API) gitRemoteMerge(w http.ResponseWriter, r *http.Request) {
	var body struct {
		TargetRef    string   `json:"target_ref"`
		SourceRefs   []string `json:"source_refs"`
		Confirmation string   `json:"confirmation"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if strings.TrimSpace(body.Confirmation) != "merge_remote" {
		writeError(w, http.StatusBadRequest, "git_remote_merge_unconfirmed", "remote branch merge requires an explicit confirmation")
		return
	}
	result, err := a.service.MergeRemoteBranches(r.Context(), r.PathValue("id"), body.TargetRef, body.SourceRefs)
	if err != nil {
		writeError(w, http.StatusBadRequest, "git_remote_merge_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}
