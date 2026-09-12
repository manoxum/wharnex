package utility

import (
	"errors"
	"fmt"
)

const (
	ProtocolV1            = "harness.utility/v1"
	TaskTranslateMarkdown = "translate_markdown"
	MaxMarkdownBytes      = 4 << 20
)

var ErrUnavailable = errors.New("utility worker is unavailable")

type LanguageCode string

const (
	LanguagePortuguese LanguageCode = "pt"
	LanguageEnglish    LanguageCode = "en"
	LanguageFrench     LanguageCode = "fr"
)

// Request is the worker-bound half of the utility wire.
//
// It carries the protocol identifier for the same reason the result does: the
// Desktop worker validates payload identity before it touches the provider, and
// a request without it is rejected as a malformed payload. Omitting the field
// here is what made every TRANSLATE_MARKDOWN task fail on its first claim with
// "invalid markdown translation worker protocol payload" — a producer/consumer
// contract break that no single side could see.
type Request struct {
	Protocol       string       `json:"protocol"`
	Task           string       `json:"task"`
	TargetLanguage LanguageCode `json:"target_language"`
	Markdown       string       `json:"markdown"`
}

type Result struct {
	Protocol       string       `json:"protocol"`
	Task           string       `json:"task"`
	TargetLanguage LanguageCode `json:"target_language"`
	Markdown       string       `json:"markdown"`
}

func ValidateRequest(request Request) error {
	if request.Protocol != ProtocolV1 {
		return fmt.Errorf("unsupported utility protocol %q", request.Protocol)
	}
	if request.Task != TaskTranslateMarkdown {
		return fmt.Errorf("unsupported utility task %q", request.Task)
	}
	if !SupportedLanguage(request.TargetLanguage) {
		return fmt.Errorf("unsupported target language %q", request.TargetLanguage)
	}
	if len(request.Markdown) > MaxMarkdownBytes {
		return fmt.Errorf("markdown exceeds %d byte utility limit", MaxMarkdownBytes)
	}
	return nil
}

func SupportedLanguage(language LanguageCode) bool {
	switch language {
	case LanguagePortuguese, LanguageEnglish, LanguageFrench:
		return true
	default:
		return false
	}
}
