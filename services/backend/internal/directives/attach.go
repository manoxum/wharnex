package directives

import (
	"path"
	"strings"
)

// AttachRules is what an `@attach` directive says should travel when it points
// at a directory.
//
// It is deliberately the same vocabulary the project's own context
// configuration uses — automatic pruning, an optional include whitelist, an
// exclude list of glob patterns — because attaching a folder is the same
// question the settings panel already answers for the project itself, and an
// operator should not have to learn a second model for it. Resolution reuses
// that same engine rather than reimplementing the predicate.
type AttachRules struct {
	// AutoExclude prunes dependencies, caches, build output, VCS metadata and
	// binaries. On by default: an external folder is far more likely than a
	// project to be something like a whole SDK checkout, and the default that
	// makes the common case sane is the one that prunes.
	AutoExclude bool
	// Include is a whitelist. Empty means everything eligible.
	Include []string
	// IncludeOverrides restores selected paths without turning the selection
	// into a whitelist.
	IncludeOverrides []string
	// Exclude removes paths that would otherwise be eligible.
	Exclude []string
}

// DefaultAttachRules is what an attachment carries when the marker says nothing.
func DefaultAttachRules() AttachRules { return AttachRules{AutoExclude: true} }

// IsDefault reports whether these rules add nothing to the default, which is
// what lets a plain attachment render as a plain marker.
func (rules AttachRules) IsDefault() bool {
	return rules.AutoExclude && len(rules.Include) == 0 && len(rules.IncludeOverrides) == 0 && len(rules.Exclude) == 0
}

// parseAttachValue splits an `@attach` payload into its path and its rules.
//
// The rules travel inside the marker rather than beside it, so that the prompt
// text remains the whole state: a prompt that is stored, re-read on a
// continuation, or shown in a transcript carries exactly the selection it was
// sent with. A selection kept somewhere else would be a selection that can
// disagree with the text it belongs to.
//
//	@{[attach]/srv/contracts}
//	@{[attach]/srv/contracts|+openapi/**|-**/*.bak}
//	@{[attach]/srv/contracts|!auto}
func parseAttachValue(raw string) (string, AttachRules, bool) {
	segments := strings.Split(raw, "|")
	target := strings.TrimSpace(segments[0])
	if target == "" || len(target) > MaxAttachPathLength {
		return "", AttachRules{}, false
	}
	// Only an absolute path. A relative one would be resolved against whatever
	// working directory happened to be current, which is not a location the
	// operator can see or reason about from inside the composer.
	if !strings.HasPrefix(target, "/") {
		return "", AttachRules{}, false
	}
	if strings.ContainsAny(target, "{}\x00") {
		return "", AttachRules{}, false
	}
	clean := path.Clean(target)
	// `path.Clean` resolves `..` lexically. Refusing a payload that needed it
	// keeps the marker honest: what is written is what is read.
	if clean != strings.TrimRight(target, "/") && clean != target {
		return "", AttachRules{}, false
	}
	rules := DefaultAttachRules()
	for _, segment := range segments[1:] {
		token := strings.TrimSpace(segment)
		if token == "" {
			continue
		}
		if token == "!auto" {
			rules.AutoExclude = false
			continue
		}
		if len(rules.Include)+len(rules.IncludeOverrides)+len(rules.Exclude) >= MaxAttachRules {
			return "", AttachRules{}, false
		}
		value := strings.TrimSpace(token[1:])
		if value == "" || !validAttachPattern(value) {
			return "", AttachRules{}, false
		}
		switch token[0] {
		case '+':
			rules.Include = append(rules.Include, value)
		case '^':
			rules.IncludeOverrides = append(rules.IncludeOverrides, value)
		case '-':
			rules.Exclude = append(rules.Exclude, value)
		default:
			return "", AttachRules{}, false
		}
	}
	return clean, rules, true
}

// parseRuleTokens reads the selection suffix shared by @attach and @ref.
// The boolean says whether a suffix was present; an unconfigured @ref inherits
// its project's whaness.yml instead of silently replacing it with defaults.
func parseRuleTokens(segments []string) (AttachRules, bool, bool) {
	if len(segments) == 0 {
		return AttachRules{}, false, true
	}
	rules := DefaultAttachRules()
	for _, segment := range segments {
		token := strings.TrimSpace(segment)
		if token == "" {
			continue
		}
		if token == "!auto" {
			rules.AutoExclude = false
			continue
		}
		if len(rules.Include)+len(rules.IncludeOverrides)+len(rules.Exclude) >= MaxAttachRules || len(token) < 2 || !validAttachPattern(strings.TrimSpace(token[1:])) {
			return AttachRules{}, true, false
		}
		value := strings.TrimSpace(token[1:])
		switch token[0] {
		case '+':
			rules.Include = append(rules.Include, value)
		case '^':
			rules.IncludeOverrides = append(rules.IncludeOverrides, value)
		case '-':
			rules.Exclude = append(rules.Exclude, value)
		default:
			return AttachRules{}, true, false
		}
	}
	return rules, true, true
}

// validAttachPattern accepts the glob vocabulary the context configuration
// already uses — `*`, `?` and `**` over relative segments — and nothing that
// could climb out of the attached root.
func validAttachPattern(pattern string) bool {
	if strings.HasPrefix(pattern, "/") || strings.ContainsAny(pattern, "{}|\x00") {
		return false
	}
	for _, segment := range strings.Split(pattern, "/") {
		if segment == ".." {
			return false
		}
	}
	return true
}

// renderAttachValue is the inverse of parseAttachValue.
func renderAttachValue(target string, rules AttachRules) string {
	var builder strings.Builder
	builder.WriteString(target)
	if !rules.AutoExclude {
		builder.WriteString("|!auto")
	}
	for _, pattern := range rules.Include {
		builder.WriteString("|+" + pattern)
	}
	for _, pattern := range rules.IncludeOverrides {
		builder.WriteString("|^" + pattern)
	}
	for _, pattern := range rules.Exclude {
		builder.WriteString("|-" + pattern)
	}
	return builder.String()
}
