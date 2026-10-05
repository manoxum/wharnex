// Package normativecontext decides which captured file bodies a Partial
// request carries before the planner has asked for anything: the project's
// normative documents (SoT/CONTEXT_PROTOCOL.md, adr/ADR-0083).
//
// A planner that starts from maps alone plans first and reads the rules after,
// if at all, so every Partial Main Request is seeded with the documents that
// govern the change. The set mirrors the authority order the planner prompt
// already names: root AGENTS.md, SoT/**/*.md, root SECURITY.md, then every
// scoped AGENTS.md below the root.
package normativecontext

import (
	"path"
	"sort"
	"strings"
)

// MaxBytes bounds the seeded bodies so the seed can never consume the
// cumulative selection budget the planner needs for its own requests.
const MaxBytes = 8 << 20

// Entry is one captured snapshot file under its request-archive name.
type Entry struct {
	Name string
	Size uint64
}

// Selection is the seeded set plus the normative files left out by MaxBytes.
// Omitted files stay requestable through an ordinary context increment.
type Selection struct {
	Paths   []string
	Bytes   uint64
	Omitted []string
}

// Select returns the normative entries below root (a request-archive content
// root such as "context/"), taken in authority order until MaxBytes. Paths are
// returned sorted, matching the cumulative selection format.
func Select(entries []Entry, root string) Selection {
	candidates := make([]Entry, 0)
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name, root) && rank(strings.TrimPrefix(entry.Name, root)) >= 0 {
			candidates = append(candidates, entry)
		}
	}
	sort.Slice(candidates, func(i, j int) bool {
		left, right := rank(strings.TrimPrefix(candidates[i].Name, root)), rank(strings.TrimPrefix(candidates[j].Name, root))
		if left != right {
			return left < right
		}
		return candidates[i].Name < candidates[j].Name
	})
	var selection Selection
	for _, entry := range candidates {
		if selection.Bytes+entry.Size > MaxBytes {
			selection.Omitted = append(selection.Omitted, entry.Name)
			continue
		}
		selection.Bytes += entry.Size
		selection.Paths = append(selection.Paths, entry.Name)
	}
	sort.Strings(selection.Paths)
	return selection
}

// rank orders a project-relative path by authority, or returns -1 when the
// path is not normative.
func rank(relative string) int {
	switch {
	case relative == "AGENTS.md":
		return 0
	case strings.HasPrefix(relative, "SoT/") && path.Ext(relative) == ".md":
		return 1
	case relative == "SECURITY.md":
		return 2
	case path.Base(relative) == "AGENTS.md":
		return 3
	default:
		return -1
	}
}
