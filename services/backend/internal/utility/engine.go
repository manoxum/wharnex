package utility

import (
	"context"
	"errors"
	"fmt"
)

const (
	ProtocolV1            = "harness.utility/v1"
	TaskTranslateMarkdown = "translate_markdown"
	MaxMarkdownBytes      = 4 << 20
)

var ErrUnavailable = errors.New("utility engine is unavailable")

type LanguageCode string

const (
	LanguagePortuguese LanguageCode = "pt"
	LanguageEnglish    LanguageCode = "en"
	LanguageFrench     LanguageCode = "fr"
)

type Request struct {
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

type Engine interface {
	Execute(context.Context, Request) (Result, error)
}

func ValidateRequest(request Request) error {
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
