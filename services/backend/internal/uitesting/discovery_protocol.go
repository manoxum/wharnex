package uitesting

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"regexp"
	"strings"
	"time"
)

const (
	DiscoveryRequestProtocolV1 = "wharnex.ui-test-discovery-input/v1"
	DiscoveryResultProtocolV1  = "harness.ui-test-discovery/v1"
	DiscoveryTask              = "discover_ui_tests"

	DiscoveryTransportPath = "transport.json"
	DiscoveryPromptPath    = "prompt/wharnex-ui-test-discovery-prompt.md"
	DiscoveryContextPath   = "context/project-context.zip"
	DiscoveryResultPath    = "discovery.json"
	MaxDiscoveryResultSize = 2 << 20
)

var discoveryTaskIDPattern = regexp.MustCompile(`^cat_[a-f0-9]{20}$`)
var discoveryCatalogIDPattern = regexp.MustCompile(`^[a-z0-9]+(?:[-_][a-z0-9]+)*$`)

type DiscoveryRequestMetadata struct {
	Protocol    string `json:"protocol"`
	ChatTitle   string `json:"chat_title"`
	ChatID      string `json:"chat_id"`
	ChatHash    string `json:"chat_hash"`
	RequestedAt string `json:"requested_at"`
}

type DiscoveryTransportManifest struct {
	Protocol        string                   `json:"protocol"`
	Task            string                   `json:"task"`
	TaskID          string                   `json:"task_id"`
	ContextSHA256   string                   `json:"context_sha256"`
	SourceSHA256    string                   `json:"source_sha256"`
	RequestFilename string                   `json:"request_filename"`
	ResultFilename  string                   `json:"result_filename"`
	ContextPath     string                   `json:"context_path"`
	ResultPath      string                   `json:"result_path"`
	RequestMetadata DiscoveryRequestMetadata `json:"request_metadata"`
}

type DiscoveryResult struct {
	Protocol      string        `json:"protocol"`
	Task          string        `json:"task"`
	TaskID        string        `json:"task_id"`
	ContextSHA256 string        `json:"context_sha256"`
	SourceSHA256  string        `json:"source_sha256"`
	Environments  []Environment `json:"environments"`
	Tests         []TestCase    `json:"tests"`
}

func DiscoveryRequestFilename(taskID string) (string, error) {
	if !discoveryTaskIDPattern.MatchString(strings.TrimSpace(taskID)) {
		return "", fmt.Errorf("invalid UI discovery task id %q", taskID)
	}
	return "whx_ui_test_discovery_req_" + taskID + ".zip", nil
}

func DiscoveryResultFilename(taskID string) (string, error) {
	if !discoveryTaskIDPattern.MatchString(strings.TrimSpace(taskID)) {
		return "", fmt.Errorf("invalid UI discovery task id %q", taskID)
	}
	return "whx_ui_test_discovery_res_" + taskID + ".zip", nil
}

func normalizeDiscoveryMetadata(taskID string, metadata DiscoveryRequestMetadata) DiscoveryRequestMetadata {
	metadata.Protocol = "harness.request-metadata/v1"
	metadata.ChatTitle = strings.Join(strings.Fields(metadata.ChatTitle), " ")
	if metadata.ChatTitle == "" {
		metadata.ChatTitle = "UI Lab discovery"
	}
	if len(metadata.ChatTitle) > 82 {
		metadata.ChatTitle = metadata.ChatTitle[:82]
	}
	metadata.ChatID = strings.TrimSpace(metadata.ChatID)
	if metadata.ChatID == "" {
		metadata.ChatID = "unbound"
	}
	metadata.ChatHash = strings.ToLower(strings.TrimSpace(metadata.ChatHash))
	if len(metadata.ChatHash) != 64 {
		digest := sha256.Sum256([]byte(metadata.ChatID + "\x00" + taskID))
		metadata.ChatHash = hex.EncodeToString(digest[:])
	}
	if _, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(metadata.RequestedAt)); err != nil {
		metadata.RequestedAt = time.Now().UTC().Format(time.RFC3339Nano)
	}
	return metadata
}
