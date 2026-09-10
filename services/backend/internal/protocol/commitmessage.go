package protocol

import (
	"fmt"
	"strings"
)

// Commit message shape limits. The subject bound is the long-standing Git
// convention (a subject beyond ~72 columns is truncated by `git log --oneline`
// and most review tools); the body is bounded only to keep one plan's metadata
// from growing without limit.
const (
	MaxCommitSubjectLength = 72
	MinCommitSubjectDetail = 12
	MaxCommitMessageBytes  = 4000
)

// conventionalCommitTypes is the closed set the protocol accepts, matching the
// planner instructions. A type outside it is a classification the rest of the
// toolchain cannot interpret.
var conventionalCommitTypes = map[string]bool{
	"feat": true, "fix": true, "refactor": true, "perf": true, "docs": true,
	"test": true, "build": true, "ci": true, "chore": true, "style": true, "revert": true,
}

// forbiddenCommitDescriptions are the low-information subjects the protocol
// explicitly instructs the planner never to emit. They are checked as a closed
// set rather than by heuristic, so the rule that is enforced is exactly the
// rule that was published.
var forbiddenCommitDescriptions = map[string]bool{
	"update files": true, "update file": true, "apply patch": true, "apply patches": true,
	"requested changes": true, "requested change": true, "implement task": true,
	"miscellaneous fixes": true, "misc fixes": true, "wharness-verified change": true,
	"wharnex-verified change": true, "update code": true, "changes": true, "fixes": true,
	"update": true, "patch": true, "implement changes": true, "various fixes": true,
	"code changes": true, "minor fixes": true, "cleanup": true, "updates": true,
}

// ValidateCommitMessage enforces the commit-history contract for a change
// plan's commit_message.
//
// It runs at bundle ingestion, deliberately BEFORE policy and sandbox
// verification: a message rejected here costs one re-request, whereas the same
// rejection at commit time would discard a fully verified candidate over prose.
//
// The message is Git-native: the first line is the subject, and anything after
// it is a body separated by one blank line. The body is where the reasoning
// that makes history useful lives, so it is permitted and encouraged, not
// flattened away.
func ValidateCommitMessage(raw string) error {
	if len(raw) > MaxCommitMessageBytes {
		return fmt.Errorf("commit_message exceeds %d byte limit", MaxCommitMessageBytes)
	}
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return fmt.Errorf("commit_message is required for a change plan: it becomes the real commit in the project's Git history")
	}
	lines := strings.Split(strings.ReplaceAll(trimmed, "\r\n", "\n"), "\n")
	subject := strings.TrimSpace(lines[0])
	if len(lines) > 1 && strings.TrimSpace(lines[1]) != "" {
		return fmt.Errorf("commit_message subject must be followed by a blank line before the body")
	}
	return validateCommitSubject(subject)
}

func validateCommitSubject(subject string) error {
	if subject == "" {
		return fmt.Errorf("commit_message subject line is empty")
	}
	if len(subject) > MaxCommitSubjectLength {
		return fmt.Errorf("commit_message subject is %d characters; keep it within %d and move detail into the body", len(subject), MaxCommitSubjectLength)
	}
	commitType, description, ok := splitConventionalSubject(subject)
	if !ok {
		return fmt.Errorf("commit_message subject must be Conventional Commits (type(scope): description), got %q", subject)
	}
	if !conventionalCommitTypes[commitType] {
		return fmt.Errorf("commit_message type %q is not one of the accepted Conventional Commits types", commitType)
	}
	normalized := strings.ToLower(strings.TrimRight(strings.TrimSpace(description), "."))
	if forbiddenCommitDescriptions[normalized] {
		return fmt.Errorf("commit_message describes bookkeeping rather than an outcome (%q); state the concrete implemented or corrected behavior", description)
	}
	if len(normalized) < MinCommitSubjectDetail {
		return fmt.Errorf("commit_message description %q is too short to identify the change; state what was implemented or corrected", description)
	}
	if looksLikeIdentifier(normalized) {
		return fmt.Errorf("commit_message description %q is an identifier, not a described outcome", description)
	}
	return nil
}

// splitConventionalSubject parses "type(scope)!: description". Scope and the
// breaking-change marker are optional.
func splitConventionalSubject(subject string) (commitType, description string, ok bool) {
	colon := strings.Index(subject, ":")
	if colon <= 0 || colon == len(subject)-1 {
		return "", "", false
	}
	prefix := subject[:colon]
	description = strings.TrimSpace(subject[colon+1:])
	if description == "" {
		return "", "", false
	}
	prefix = strings.TrimSuffix(prefix, "!")
	if open := strings.Index(prefix, "("); open >= 0 {
		if !strings.HasSuffix(prefix, ")") || open == 0 {
			return "", "", false
		}
		scope := prefix[open+1 : len(prefix)-1]
		if strings.TrimSpace(scope) == "" {
			return "", "", false
		}
		prefix = prefix[:open]
	}
	commitType = strings.ToLower(strings.TrimSpace(prefix))
	if commitType == "" || strings.ContainsAny(commitType, " \t") {
		return "", "", false
	}
	return commitType, description, true
}

// looksLikeIdentifier catches a description that is really a request/plan id
// rather than a sentence — a single token carrying digits and separators,
// which the protocol calls out specifically.
func looksLikeIdentifier(description string) bool {
	if strings.ContainsAny(description, " \t") {
		return false
	}
	return strings.ContainsAny(description, "0123456789") && strings.ContainsAny(description, "_-")
}
