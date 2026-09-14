// Package translation owns the bundle protocol Wharnex uses to ask ChatGPT for
// a translated document and to accept the answer.
//
// Translation used to travel as a bare Markdown attachment with the whole
// instruction pasted into the composer, and the answer as a bare Markdown file.
// That shape has no contract to enforce: nothing said which document the reply
// belonged to, nothing bound the reply to the requested language, and the only
// check available was "a file with roughly the right name arrived". When the
// model answered in prose, attached the source back, or produced a file under a
// different name, the worker had nothing to reject and simply waited until it
// timed out — the translation jobs that sat stuck in the queue.
//
// So translation now uses the same shape as every other exchange with the
// provider: one request bundle in, one response bundle out, each carrying its
// own protocol identity, and the response validated fail-closed before a single
// byte is used. `source_sha256` is the centre of that contract: it is what makes
// "this is the translation of the document we sent" a checkable statement rather
// than an assumption.
package translation

import (
	"fmt"
	"regexp"
	"strings"
)

const (
	// RequestProtocolV1 identifies the archive Wharnex uploads.
	RequestProtocolV1 = "wharness.translation-input/v1"
	// ResultProtocolV1 identifies the bundle ChatGPT returns.
	ResultProtocolV1 = "harness.translation/v1"

	// TaskTranslateDocument is the only task version 1 defines. It exists as a
	// field so a second utility task can join this protocol without a new one.
	TaskTranslateDocument = "translate_document"

	// MaxSourceBytes bounds what may be sent. MaxResultBytes is deliberately
	// larger: a faithful translation routinely grows, and rejecting a correct
	// answer for being longer than its source would be a defect.
	MaxSourceBytes = 4 << 20
	MaxResultBytes = 8 << 20

	// MaxBundleBytes bounds the compressed response, maxExpandedBytes the sum of
	// its entries, so a small archive cannot expand into an unbounded one.
	MaxBundleBytes   = 12 << 20
	maxExpandedBytes = 24 << 20
	maxEntries       = 32

	// SourcePath and ResultPath are fixed rather than declared by the producer.
	// A path the model chooses is a path the model can get wrong, and there is
	// no benefit here to letting it choose: exactly one document goes each way.
	SourcePath = "source/document.md"
	ResultPath = "translation/document.md"

	// PromptPath carries the authoritative instruction. It lives inside the
	// archive because the composer carries only a bounded bootstrap — the same
	// rule every other request transport already follows.
	PromptPath = "prompt/wharness-translation-prompt.md"
	// TransportPath and ResultManifestPath are each bundle's own identity.
	TransportPath      = "transport.json"
	ResultManifestPath = "translation.json"
)

// taskIDPattern is the durable chat-agent task id. Both filenames are derived
// from it, so an id that does not match cannot name a file at all.
var taskIDPattern = regexp.MustCompile(`^cat_[a-f0-9]{20}$`)

// ValidateTaskID rejects anything that could not have come from the queue.
func ValidateTaskID(taskID string) error {
	if !taskIDPattern.MatchString(strings.TrimSpace(taskID)) {
		return fmt.Errorf("invalid translation task id %q", taskID)
	}
	return nil
}

// RequestFilename and ResultFilename are the exact names both sides expect.
//
// They are exact on purpose. The response is accepted by name before it is
// opened, so a name that merely resembles the expected one — a different task's
// bundle, a re-download of an earlier answer — is refused rather than parsed.
func RequestFilename(taskID string) (string, error) {
	if err := ValidateTaskID(taskID); err != nil {
		return "", err
	}
	return "whx_translation_req_" + strings.TrimSpace(taskID) + ".zip", nil
}

func ResultFilename(taskID string) (string, error) {
	if err := ValidateTaskID(taskID); err != nil {
		return "", err
	}
	return "whx_translation_res_" + strings.TrimSpace(taskID) + ".zip", nil
}

// LanguageName is the English name the prompt uses. An unsupported code returns
// empty so the caller fails closed rather than asking for a language nobody
// named.
func LanguageName(code string) string {
	switch strings.TrimSpace(strings.ToLower(code)) {
	case "pt":
		return "Portuguese"
	case "en":
		return "English"
	case "fr":
		return "French"
	default:
		return ""
	}
}

// TransportManifest is the request archive's root document.
type TransportManifest struct {
	Protocol        string `json:"protocol"`
	Task            string `json:"task"`
	TaskID          string `json:"task_id"`
	TargetLanguage  string `json:"target_language"`
	RequestFilename string `json:"request_filename"`
	SourcePath      string `json:"source_path"`
	SourceSHA256    string `json:"source_sha256"`
	SourceBytes     int    `json:"source_bytes"`
	ResultPath      string `json:"result_path"`
	ResultFilename  string `json:"result_filename"`
}

// ResultManifest is the response bundle's root document.
//
// Every field is checked against what was asked for. SourceSHA256 is the one
// that matters most: without it, "the model translated a different document"
// and "the model translated this document" are the same observation.
type ResultManifest struct {
	Protocol       string `json:"protocol"`
	Task           string `json:"task"`
	TaskID         string `json:"task_id"`
	TargetLanguage string `json:"target_language"`
	SourceSHA256   string `json:"source_sha256"`
	ResultPath     string `json:"result_path"`
}

// Result is what the engine hands back once the bundle has been validated.
type Result struct {
	TaskID         string
	TargetLanguage string
	SourceSHA256   string
	Markdown       string
}
