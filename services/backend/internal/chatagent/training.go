package chatagent

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

// Dynamic behavior training.
//
// When a verb cannot find its control, the agent captures a bounded structural
// snapshot of the page — tags, attributes and nesting, never text nodes. This
// file turns such a snapshot into a candidate Patch: it proposes new selectors
// for the key that failed, derived from what is actually on the page now.
//
// The proposal is conservative by construction. It only ever emits selectors
// built from stable, semantic attributes, and it never emits a selector built
// from a class name: provider builds hash their class names, so a class-derived
// selector works until the next deploy and then fails silently. Anything it
// cannot express that way is left for a human.

// Node is one element of a captured structural snapshot.
type Node struct {
	Tag      string            `json:"tag"`
	Attrs    map[string]string `json:"attrs"`
	Children []Node            `json:"children,omitempty"`
}

// Snapshot is what the agent captures when a verb fails.
type Snapshot struct {
	URL      string `json:"url"`
	Title    string `json:"title,omitempty"`
	Provider string `json:"provider"`
	// Which selector key the agent was looking for when it failed.
	SelectorKey string `json:"selector_key"`
	Optional    bool   `json:"optional"`
	Roots       []struct {
		Selector string `json:"selector"`
		Tree     Node   `json:"tree"`
	} `json:"roots"`
}

// Attributes that carry meaning across builds, most specific first. A selector
// derived from one of these survives a redeploy; one derived from a class name
// does not.
var stableAttributes = []string{
	"data-testid",
	"data-conversation-options-trigger",
	"data-page-table-selection-id",
	"name",
	"role",
	"aria-label",
	"aria-haspopup",
	"aria-expanded",
	"aria-keyshortcuts",
	"contenteditable",
	"type",
}

// Attributes whose values are per-instance identifiers: matching them exactly
// would produce a selector that works for exactly one conversation and nothing
// else.
var volatileAttributes = map[string]bool{
	"id":                                true,
	"data-conversation-options-trigger": true,
	"data-page-table-selection-id":      true,
	"aria-describedby":                  true,
	"aria-controls":                     true,
}

func selectorFor(node Node) []string {
	var out []string
	for _, attr := range stableAttributes {
		value, present := node.Attrs[attr]
		if !present {
			continue
		}
		if volatileAttributes[attr] {
			// Presence is stable even when the value is not.
			out = append(out, fmt.Sprintf("%s[%s]", node.Tag, attr))
			continue
		}
		value = strings.TrimSpace(value)
		if value == "" || len(value) > 120 || strings.ContainsAny(value, `"\`) {
			continue
		}
		out = append(out, fmt.Sprintf("%s[%s=%q]", node.Tag, attr, value))
	}
	return out
}

func walk(node Node, visit func(Node)) {
	visit(node)
	for _, child := range node.Children {
		walk(child, visit)
	}
}

// ProposePatch derives candidate selectors for the failing key from a snapshot.
//
// `hints` are the tag/attribute shapes the caller believes the control has —
// normally taken from the seed's own selector for that key, so a proposal stays
// anchored to the kind of control the verb actually needs rather than offering
// every element on the page.
func ProposePatch(snapshot Snapshot, hints []string, sequence int, createdBy string) (Patch, error) {
	key := strings.TrimSpace(snapshot.SelectorKey)
	if key == "" {
		return Patch{}, fmt.Errorf("snapshot does not name the selector key that failed")
	}

	wanted := map[string]bool{}
	for _, hint := range hints {
		for _, attr := range stableAttributes {
			if strings.Contains(hint, attr) {
				wanted[attr] = true
			}
		}
	}

	seen := map[string]bool{}
	var candidates []string
	for _, root := range snapshot.Roots {
		walk(root.Tree, func(node Node) {
			if node.Tag == "" {
				return
			}
			for _, candidate := range selectorFor(node) {
				// Keep the proposal anchored: only shapes the verb already
				// looks for, so a failing "composer" lookup cannot be answered
				// with a selector for an unrelated button.
				if len(wanted) > 0 {
					matched := false
					for attr := range wanted {
						if strings.Contains(candidate, attr) {
							matched = true
							break
						}
					}
					if !matched {
						continue
					}
				}
				if seen[candidate] {
					continue
				}
				seen[candidate] = true
				candidates = append(candidates, candidate)
			}
		})
	}
	if len(candidates) == 0 {
		return Patch{}, fmt.Errorf("no stable selector candidate found for %q; escalate to a human", key)
	}
	sort.Strings(candidates)
	if len(candidates) > maxSelectorsPerKey {
		candidates = candidates[:maxSelectorsPerKey]
	}

	patch := Patch{
		Sequence:       sequence,
		State:          PatchProposed,
		Reason:         fmt.Sprintf("%s not found at %s", key, snapshot.URL),
		EvidenceSHA256: snapshot.SHA256(),
		CreatedBy:      createdBy,
		Note:           fmt.Sprintf("derived %d candidate(s) from a structural snapshot", len(candidates)),
	}
	if snapshot.Optional {
		patch.OptionalSelectors = map[string][]string{key: candidates}
	} else {
		patch.Selectors = map[string][]string{key: candidates}
	}
	return patch, nil
}

// SHA256 identifies the evidence a patch was derived from, so a proposal can
// always be traced back to the page state that produced it.
func (s Snapshot) SHA256() string {
	encoded, err := json.Marshal(s)
	if err != nil {
		return ""
	}
	sum := sha256.Sum256(encoded)
	return hex.EncodeToString(sum[:])
}
