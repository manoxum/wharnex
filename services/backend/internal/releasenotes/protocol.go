// Package releasenotes owns the strict ZIP exchange used to ask ChatGPT for
// Git release notes. The Desktop transports opaque bundles; the backend owns
// and validates the request/result contract.
package releasenotes

import (
	"fmt"
	"regexp"
	"strings"
)

const (
	RequestProtocolV1 = "wharness.release-notes-input/v1"
	ResultProtocolV1  = "harness.release-notes/v1"
	TaskGenerate      = "generate_release_notes"

	MaxSourceBytes = 256 << 10
	MaxResultBytes = 1 << 20
	MaxBundleBytes = 2 << 20

	TransportPath      = "transport.json"
	PromptPath         = "prompt/wharnex-release-notes-prompt.md"
	SourcePath         = "source/commits.md"
	ResultManifestPath = "release-notes.json"
	ResultPath         = "release-notes.md"

	maxExpandedBytes = 4 << 20
	maxEntries       = 8
)

var taskIDPattern = regexp.MustCompile(`^cat_[a-f0-9]{20}$`)

func ValidateTaskID(taskID string) error {
	if !taskIDPattern.MatchString(strings.TrimSpace(taskID)) {
		return fmt.Errorf("invalid release-notes task id %q", taskID)
	}
	return nil
}

func RequestFilename(taskID string) (string, error) {
	if err := ValidateTaskID(taskID); err != nil {
		return "", err
	}
	return "whx_release_notes_req_" + strings.TrimSpace(taskID) + ".zip", nil
}

func ResultFilename(taskID string) (string, error) {
	if err := ValidateTaskID(taskID); err != nil {
		return "", err
	}
	return "whx_release_notes_res_" + strings.TrimSpace(taskID) + ".zip", nil
}

type RequestMetadata struct {
	Protocol    string `json:"protocol"`
	ChatTitle   string `json:"chat_title"`
	ChatID      string `json:"chat_id"`
	ChatHash    string `json:"chat_hash"`
	RequestedAt string `json:"requested_at"`
}

type TransportManifest struct {
	Protocol        string          `json:"protocol"`
	Task            string          `json:"task"`
	TaskID          string          `json:"task_id"`
	Branch          string          `json:"branch"`
	RequestFilename string          `json:"request_filename"`
	ResultFilename  string          `json:"result_filename"`
	SourcePath      string          `json:"source_path"`
	SourceSHA256    string          `json:"source_sha256"`
	SourceBytes     int             `json:"source_bytes"`
	ResultPath      string          `json:"result_path"`
	RequestMetadata RequestMetadata `json:"request_metadata"`
}

type ResultManifest struct {
	Protocol     string `json:"protocol"`
	Task         string `json:"task"`
	TaskID       string `json:"task_id"`
	Branch       string `json:"branch"`
	SourceSHA256 string `json:"source_sha256"`
	ResultPath   string `json:"result_path"`
}

type Result struct {
	TaskID string
	Branch string
	Body   string
}
