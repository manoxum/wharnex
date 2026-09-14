// Package directives owns the composer directive language: the small syntax an
// operator writes inside a prompt to point at something Wharnex should resolve.
//
// There are two kinds and one grammar. `@file` points at a file in the project
// the request belongs to; `@ref` points at another project, optionally at one
// file inside it, and is also what grants that project's writability for the
// request (see internal/crossproject). Both are parsed here so the two can
// never drift into two dialects of the same idea.
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
// # Two spellings, one canonical
//
// What the operator types is `@file:path` or `@ref:project/path`, optionally
// wrapped in `<<…>>` when the value contains spaces. What travels to the model
// is the canonical `@{[file]path}` / `@{[ref]project/path}` — a form that is
// unambiguous to scan, cannot run into the following word, and reads as a
// marker rather than as prose. Both are accepted on input, because a prompt can
// be re-submitted after a round trip and must mean the same thing twice.
package directives

import (
	"fmt"
	"path"
	"regexp"
	"strings"
)

// Kind is which of the two directives this is.
type Kind string

const (
	KindFile Kind = "file"
	KindRef  Kind = "ref"
)

const (
	// MaxValueLength bounds one directive's payload. Values are project paths;
	// anything longer is not one.
	MaxValueLength = 512
	// MaxDirectives bounds how many one prompt may carry, so a pathological
	// paste cannot turn into unbounded work downstream.
	MaxDirectives = 128
)

// pattern matches both spellings in one pass, so a prompt mixing them — which
// happens the moment a canonicalized prompt is edited by hand — parses the same
// way throughout.
//
// The canonical form is matched first because `@{[file]…}` would otherwise also
// satisfy nothing in the typed alternatives and be left as prose.
var pattern = regexp.MustCompile(`@\{\[(file|ref)\]([^{}\n]*)\}|@(file|ref):(?:<<([^<>\n]*)>>|([^\s<>{}]*))`)

// Directive is one parsed reference, with the byte range it occupied.
type Directive struct {
	Kind Kind
	// Value is the whole payload: a project-relative path for KindFile, and
	// `project` or `project/path` for KindRef.
	Value string
	// Project and Path split Value for KindRef. For KindFile, Path is Value and
	// Project is empty.
	Project string
	Path    string
	// Start and End are the byte offsets this directive occupied in the text it
	// was parsed from, so a renderer can draw it in place.
	Start int
	End   int
}

var namePattern = regexp.MustCompile(`^[A-Za-z0-9._-]+$`)

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

// matchValue reads whichever alternative of the pattern actually matched.
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
	if kind, ok := group(3); ok {
		if value, has := group(4); has {
			return Kind(kind), value
		}
		value, _ := group(5)
		return Kind(kind), value
	}
	return "", ""
}

func build(kind Kind, raw string) (Directive, bool) {
	// Only a trailing separator is cosmetic (`@ref:core/` is the project). A
	// leading one is an absolute path, and trimming it here would quietly repair
	// `@file:/etc/passwd` into a relative reference — exactly the invented
	// meaning this parser refuses to supply.
	value := strings.TrimRight(strings.TrimSpace(raw), "/")
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
	case KindRef:
		project, file := value, ""
		if index := strings.Index(value, "/"); index >= 0 {
			project, file = value[:index], strings.TrimSpace(value[index+1:])
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
		return Directive{Kind: KindRef, Value: canonical, Project: project, Path: file}, true
	}
	return Directive{}, false
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
