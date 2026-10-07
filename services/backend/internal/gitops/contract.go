package gitops

import "kernl.local/harness/backend/internal/gitops/recovery"

// HostRequest is the existing restricted host Git bridge vocabulary. Recovery
// accepts only Operation and Root; it derives the metadata path on the host.
type HostRequest struct {
	Operation   string `json:"operation"`
	Root        string `json:"root"`
	Remote      string `json:"remote"`
	Branch      string `json:"branch,omitempty"`
	CommitSHA   string `json:"commit_sha,omitempty"`
	Tag         string `json:"tag,omitempty"`
	Title       string `json:"title,omitempty"`
	Body        string `json:"body,omitempty"`
	SetUpstream bool   `json:"set_upstream,omitempty"`
}

type HostResult struct {
	Output   string           `json:"output,omitempty"`
	ExitCode int              `json:"exit_code"`
	Error    string           `json:"error,omitempty"`
	Recovery *recovery.Result `json:"recovery,omitempty"`
}
