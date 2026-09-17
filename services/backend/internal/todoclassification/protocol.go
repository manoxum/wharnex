package todoclassification

import (
	"fmt"
	"regexp"
	"strings"
)

const (
	RequestProtocolV1 = "wharness.todo-classification-input/v1"
	ResultProtocolV1  = "harness.todo-classification/v1"
	TaskClassifyTodo  = "classify_todo"

	TransportPath = "transport.json"
	PromptPath    = "prompt/wharnex-todo-classification-prompt.md"
	SourcePath    = "todo/todo.md"
	ResultPath    = "classification.json"

	MaxSourceBytes = 64 << 10
	MaxBundleBytes = 256 << 10
)

var taskIDPattern = regexp.MustCompile(`^cat_[a-f0-9]{20}$`)

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
	TodoID          string          `json:"todo_id"`
	RequestFilename string          `json:"request_filename"`
	ResultFilename  string          `json:"result_filename"`
	SourcePath      string          `json:"source_path"`
	SourceSHA256    string          `json:"source_sha256"`
	ResultPath      string          `json:"result_path"`
	RequestMetadata RequestMetadata `json:"request_metadata"`
}

type Result struct {
	Protocol     string `json:"protocol"`
	Task         string `json:"task"`
	TaskID       string `json:"task_id"`
	TodoID       string `json:"todo_id"`
	SourceSHA256 string `json:"source_sha256"`
	Kind         string `json:"kind"`
	Urgency      string `json:"urgency"`
}

func RequestFilename(taskID string) (string, error) {
	if err := validateTaskID(taskID); err != nil {
		return "", err
	}
	return "whx_todo_classification_req_" + taskID + ".zip", nil
}

func ResultFilename(taskID string) (string, error) {
	if err := validateTaskID(taskID); err != nil {
		return "", err
	}
	return "whx_todo_classification_res_" + taskID + ".zip", nil
}

func validKind(value string) bool {
	switch value {
	case "feature", "improvement", "error":
		return true
	default:
		return false
	}
}

func validUrgency(value string) bool {
	switch value {
	case "very_urgent", "urgent", "normal", "no_urgency":
		return true
	default:
		return false
	}
}

func validateTaskID(value string) error {
	if !taskIDPattern.MatchString(strings.TrimSpace(value)) {
		return fmt.Errorf("invalid TODO classification task id %q", value)
	}
	return nil
}
