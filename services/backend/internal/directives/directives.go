// Package directives owns the composer directive language: the small syntax an
// operator writes inside a prompt to point at something Wharnex should resolve.
//
// There is one grammar for project paths, cross-project references, external
// attachments, stored chat/library artifacts, TODOs, completed tasks and spotlight references.
// `@file` can name a file or directory anywhere inside the request's project;
// the app may expand the request-local context to include it. `@see` adds no
// bytes or write authority: it only spotlights a target already reachable via
// @file/@ref/@attach/@chat/@lib or a direct upload. All kinds are parsed here so
// the frontend and backend cannot drift into separate directive dialects.
//
// # Position is meaning
//
// A directive stays where the operator wrote it. It used to be stripped out and
// re-listed at the bottom of the prompt, which loses the only thing the
// placement was carrying: "this file, in this sentence, is the one I mean".
// A prompt reading "compare the handler in @{[file]a.ts} with @{[ref]core/b.ts}"
// says something a trailing list of two paths does not, and the difference is
// exactly the part a reader needs.
//
// # Several spellings, one canonical
//
// What the operator types is `@file:path`, `@ref:project/path` or
// `@attach:/abs/path`, optionally wrapped in `<<…>>` when the value contains
// spaces. `@ref` and `@attach` also accept alternate keywords — see Keywords —
// because an operator reaching for "the other project" or "something outside
// the project" should not have to remember one exact word to mean it. What
// travels to the model is always the canonical `@{[file]path}` /
// `@{[ref]project/path}` / `@{[attach]path}` — a form that is unambiguous to
// scan, cannot run into the following word, and reads as a marker rather than
// as prose. Every typed spelling is accepted on input, because a prompt can be
// re-submitted after a round trip and must mean the same thing twice.
package directives

import (
	"fmt"
	"path"
	"strings"
)

// Kind is which directive this is.
type Kind string

const (
	KindFile Kind = "file"
	KindRef  Kind = "ref"
	// KindAttach names a file or directory outside the project. It is the one
	// directive whose value is an absolute host path, because that is the whole
	// point of it: the operator is pointing at something the project does not
	// contain. It grants reading, never writing.
	KindAttach Kind = "attach"
	// KindSee spotlights content already reachable through another request
	// source. It can point through @file/@ref/@attach, a direct upload, @chat or
	// @lib; resolving the bytes stays with those source transports. Parsing and
	// canonicalizing it here keeps the marker stable and in place without
	// turning the spotlight into a second attachment UI state.
	KindSee Kind = "see"
	// KindChat points at a persisted file that belongs to the current chat.
	KindChat Kind = "chat"
	// KindLib points at a persisted file in the global Wharnex library.
	KindLib Kind = "lib"
	// KindTodo points at one project TODO by its stable ID.
	KindTodo Kind = "todo"
	// KindTask points at one completed Orchestrator task in the current project.
	KindTask Kind = "task"
)

const (
	// MaxValueLength bounds one directive's payload, whether it is a path or a
	// stable record identifier.
	MaxValueLength = 512
	// MaxDirectives bounds how many one prompt may carry, so a pathological
	// paste cannot turn into unbounded work downstream.
	MaxDirectives = 128
	// MaxAttachRules bounds the include/exclude patterns one attachment may
	// carry. They travel inside the marker, so an unbounded list would be an
	// unbounded prompt.
	MaxAttachRules = 32
	// MaxAttachPathLength bounds an attachment's absolute path.
	MaxAttachPathLength = 4096
)

// Directive is one parsed reference, with the byte range it occupied.
type Directive struct {
	Kind Kind
	// Value is the whole payload: a project-relative path for KindFile,
	// `project` or `project/path` for KindRef, or a stable record ID.
	Value string
	// Project and Path split Value for KindRef. For KindFile and KindAttach,
	// Path is the path half of Value and Project is empty.
	Project string
	Path    string
	// Source qualifies KindSee as file/project, ref, attach, upload, chat, lib or
	// todo. Empty is the legacy bare-upload spelling and is interpreted as upload.
	Source string
	// Rules is the include/exclude selection for a KindAttach directive that
	// points at a directory. It is deliberately the same shape the project's own
	// context configuration uses, so attaching a folder is configured with the
	// same vocabulary — and by the same engine — as the project context itself.
	Rules         AttachRules
	RulesExplicit bool
	// Start and End are the byte offsets this directive occupied in the text it
	// was parsed from, so a renderer can draw it in place.
	Start int
	End   int
}

// Parse extracts every well-formed directive, in the order they appear.
//
// A malformed one is left alone rather than repaired. `@ref:../etc` is not a
// reference with a bad path; it is prose that happens to start with `@ref:`,
// and inventing a meaning for it is how a traversal becomes a resolved path.
func Parse(text string) []Directive {
	matches := pattern.FindAllStringSubmatchIndex(text, -1)
	parsed := make([]Directive, 0, len(matches))
	for _, match := range matches {
		if len(parsed) >= MaxDirectives {
			break
		}
		kind, value := matchValue(text, match)
		if kind == "" {
			continue
		}
		directive, ok := build(kind, value)
		if !ok {
			continue
		}
		directive.Start, directive.End = match[0], match[1]
		parsed = append(parsed, directive)
	}
	return parsed
}

// matchValue reads whichever alternative of the pattern actually matched, and
// normalizes a typed alias to its canonical Kind.
func matchValue(text string, match []int) (Kind, string) {
	group := func(index int) (string, bool) {
		start, end := match[2*index], match[2*index+1]
		if start < 0 {
			return "", false
		}
		return text[start:end], true
	}
	if kind, ok := group(1); ok {
		value, _ := group(2)
		return Kind(kind), value
	}
	if keyword, ok := group(3); ok {
		kind, known := kindAliases[keyword]
		if !known {
			return "", ""
		}
		if value, has := group(4); has {
			return kind, value
		}
		value, _ := group(5)
		return kind, value
	}
	return "", ""
}

func build(kind Kind, raw string) (Directive, bool) {
	// An attachment payload carries its own rule tokens and an absolute path, so
	// it is read by its own parser before the project-relative trimming below
	// could mangle it.
	if kind == KindAttach {
		target, rules, ok := parseAttachValue(strings.TrimSpace(raw))
		if !ok {
			return Directive{}, false
		}
		return Directive{Kind: KindAttach, Value: renderAttachValue(target, rules), Path: target, Rules: rules}, true
	}
	// Only a trailing separator is cosmetic (`@ref:core/` is the project). A
	// leading one is an absolute path, and trimming it here would quietly repair
	// `@file:/etc/passwd` into a relative reference — exactly the invented
	// meaning this parser refuses to supply.
	// A trailing separator or full stop is sentence punctuation, never part of
	// what was being named. A leading separator is an absolute path, and
	// trimming that would quietly repair `@file:/etc/passwd` into a relative
	// reference — exactly the invented meaning this parser refuses to supply.
	value := strings.TrimRight(strings.TrimSpace(raw), "/.")
	if value == "" || len(value) > MaxValueLength {
		return Directive{}, false
	}
	switch kind {
	case KindFile:
		clean, ok := safeRelativePath(value)
		if !ok {
			return Directive{}, false
		}
		return Directive{Kind: KindFile, Value: clean, Path: clean}, true
	case KindSee:
		return parseSeeValue(strings.TrimSpace(raw))
	case KindChat:
		return parseChatValue(strings.TrimSpace(raw))
	case KindLib:
		return parseLibraryValue(strings.TrimSpace(raw))
	case KindTodo:
		if !namePattern.MatchString(value) {
			return Directive{}, false
		}
		return Directive{Kind: KindTodo, Value: value, Path: value}, true
	case KindTask:
		return parseTaskValue(value)
	case KindRef:
		segments := strings.Split(raw, "|")
		target := strings.TrimRight(strings.TrimSpace(segments[0]), "/.")
		project, file := target, ""
		if index := strings.Index(target, "/"); index >= 0 {
			project, file = target[:index], strings.TrimSpace(target[index+1:])
		}
		if !ValidProjectName(project) {
			return Directive{}, false
		}
		if file != "" {
			clean, ok := safeRelativePath(file)
			if !ok {
				return Directive{}, false
			}
			file = clean
		}
		canonical := project
		if file != "" {
			canonical = project + "/" + file
		}
		rules, explicit, ok := parseRuleTokens(segments[1:])
		if !ok {
			return Directive{}, false
		}
		if explicit {
			canonical = renderAttachValue(canonical, rules)
		}
		return Directive{Kind: KindRef, Value: canonical, Project: project, Path: file, Rules: rules, RulesExplicit: explicit}, true
	}
	return Directive{}, false
}

func parseChatValue(raw string) (Directive, bool) {
	if raw == "" || len(raw) > MaxValueLength || strings.ContainsAny(raw, "{}\x00\r\n") {
		return Directive{}, false
	}
	if strings.HasPrefix(raw, "artifact|") {
		id := strings.TrimPrefix(raw, "artifact|")
		if !namePattern.MatchString(id) {
			return Directive{}, false
		}
		return Directive{Kind: KindChat, Value: raw, Path: id, Source: "artifact"}, true
	}
	if strings.HasPrefix(raw, "entry|") {
		parts := strings.SplitN(raw, "|", 3)
		if len(parts) != 3 || !namePattern.MatchString(parts[1]) {
			return Directive{}, false
		}
		entry, ok := safeRelativePath(parts[2])
		if !ok {
			return Directive{}, false
		}
		return Directive{Kind: KindChat, Value: "entry|" + parts[1] + "|" + entry, Project: parts[1], Path: entry, Source: "entry"}, true
	}
	name, ok := safeAttachmentName(raw)
	if !ok {
		return Directive{}, false
	}
	return Directive{Kind: KindChat, Value: name, Path: name, Source: "name"}, true
}

func parseLibraryValue(raw string) (Directive, bool) {
	parts := strings.Split(raw, "|")
	if len(parts) != 3 || parts[0] != "session" || !namePattern.MatchString(parts[1]) || !namePattern.MatchString(parts[2]) {
		return Directive{}, false
	}
	value := "session|" + parts[1] + "|" + parts[2]
	return Directive{Kind: KindLib, Value: value, Project: parts[1], Path: parts[2], Source: "library"}, true
}

// safeAttachmentName accepts only a bare file name: no path separator, since a
// direct chat attachment is identified by name alone, never by a location —
// it has none here, having already been persisted through its own transport.
func safeAttachmentName(value string) (string, bool) {
	if strings.ContainsAny(value, "{}\x00/\\") {
		return "", false
	}
	return value, true
}

// safeRelativePath accepts only a normalized project-relative path.
//
// Braces are rejected along with traversal and absolute paths: the canonical
// form is delimited by them, so a value containing one could not survive a
// round trip through the text it is written into.
func safeRelativePath(value string) (string, bool) {
	if strings.ContainsAny(value, "{}\x00") {
		return "", false
	}
	clean := path.Clean(value)
	if clean == "." || clean == ".." || strings.HasPrefix(clean, "../") || strings.HasPrefix(clean, "/") {
		return "", false
	}
	return clean, true
}

// ValidProjectName reports whether a string can name a project. Project names
// are directory basenames, and the grant is keyed on them.
// `.` and `..` satisfy the charset but name a traversal rather than a project,
// so they are excluded by name: the grant is keyed on this string and resolved
// against real directories.
func ValidProjectName(name string) bool {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" || trimmed == "." || trimmed == ".." || len(trimmed) > 128 {
		return false
	}
	return namePattern.MatchString(trimmed)
}

// Canonical renders one directive in the form that travels to the model.
func Canonical(directive Directive) string {
	return fmt.Sprintf("@{[%s]%s}", directive.Kind, directive.Value)
}

// Canonicalize rewrites every directive in a prompt to its canonical form,
// leaving everything else — including malformed near-misses — exactly as
// written.
//
// This is what makes the marker stable: whatever the operator typed, what the
// model reads, what the engine re-parses on a continuation, and what a stored
// transcript shows are all the same string.
func Canonicalize(text string) string {
	parsed := Parse(text)
	if len(parsed) == 0 {
		return text
	}
	var builder strings.Builder
	builder.Grow(len(text))
	cursor := 0
	for _, directive := range parsed {
		builder.WriteString(text[cursor:directive.Start])
		builder.WriteString(Canonical(directive))
		cursor = directive.End
	}
	builder.WriteString(text[cursor:])
	return builder.String()
}

// Of returns only the directives of one kind, preserving order.
func Of(parsed []Directive, kind Kind) []Directive {
	filtered := make([]Directive, 0, len(parsed))
	for _, directive := range parsed {
		if directive.Kind == kind {
			filtered = append(filtered, directive)
		}
	}
	return filtered
}

// Values returns the distinct values of the given kind, in first-seen order.
func Values(parsed []Directive, kind Kind) []string {
	seen := make(map[string]bool)
	values := make([]string, 0, len(parsed))
	for _, directive := range parsed {
		if directive.Kind != kind || seen[directive.Value] {
			continue
		}
		seen[directive.Value] = true
		values = append(values, directive.Value)
	}
	return values
}
