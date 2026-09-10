// Package chatagent owns the materialized behavior documents that tell a
// Wharnex chat agent how to drive a remote AI chat surface.
//
// The agent owns *how* to drive a browser instance; a behavior document owns
// *what* to drive in it — selectors, menu labels, timing budgets, verification
// requirements. Keeping the two apart is what lets a second provider be added
// by shipping another document instead of another agent, and lets a provider UI
// change be absorbed by updating data rather than editing control flow.
//
// A document has two layers. The seed layer ships with the backend as embedded
// JSON and is migrated into the database on first start. The overlay layer is
// what a training/evolution pass learns from the live page. The effective
// document handed to an agent is the merge of the two, computed here so the
// merge semantics live in exactly one place.
package chatagent

import (
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
)

const Schema = "harness.chat-agent-behavior/v1"

// Bounds that keep a malformed or hostile document from producing an agent that
// hangs, spins, or drives a browser with an unusable selector.
const (
	maxSelectorsPerKey = 12
	maxSelectorLength  = 400
	maxLabelsPerKey    = 24
	minTimingMs        = 1
	maxTimingMs        = 600_000
)

type Reasoning struct {
	Enabled       bool     `json:"enabled"`
	MaxRows       int      `json:"max_rows"`
	MaxRowChars   int      `json:"max_row_chars"`
	MinRowChars   int      `json:"min_row_chars"`
	ExcludeWithin []string `json:"exclude_within"`
}

type EffortLevel struct {
	ID     string   `json:"id"`
	Labels []string `json:"labels"`
}

type Anomaly struct {
	CaptureSelectors     []string `json:"capture_selectors"`
	MaxCaptureBytes      int      `json:"max_capture_bytes"`
	EscalateAfterRepeats int      `json:"escalate_after_repeats"`
}

type Document struct {
	Schema              string                     `json:"schema"`
	Provider            string                     `json:"provider"`
	Revision            string                     `json:"revision"`
	Origin              string                     `json:"origin"`
	BaseURL             string                     `json:"base_url"`
	TrustedHosts        []string                   `json:"trusted_hosts"`
	ConversationPath    string                     `json:"conversation_path"`
	NewConversationPath string                     `json:"new_conversation_path"`
	Selectors           map[string][]string        `json:"selectors"`
	OptionalSelectors   map[string][]string        `json:"optional_selectors"`
	Reasoning           Reasoning                  `json:"reasoning"`
	Labels              map[string][]string        `json:"labels"`
	EffortLevels        []EffortLevel              `json:"effort_levels"`
	Timing              map[string]int             `json:"timing"`
	Verification        map[string]json.RawMessage `json:"verification"`
	Anomaly             Anomaly                    `json:"anomaly"`
}

// PatchState is a patch's position in its own lifecycle. A patch is proposed
// from evidence, promoted only once it has been observed to actually work, and
// retired when it stops working or is superseded.
type PatchState string

const (
	// Stored and merged, but not yet proven against the live page.
	PatchProposed PatchState = "proposed"
	// Observed to make the previously failing verb succeed.
	PatchActive PatchState = "active"
	// Refused: it produced an invalid document, or it never worked.
	PatchRejected PatchState = "rejected"
)

// Patch is one increment applied on top of the seed document.
//
// Patches form an ordered chain rather than a single overlay so the behavior
// can keep absorbing successive page changes without any step losing the
// context of why it exists. Each carries the evidence that produced it, which is
// what makes a bad learning cycle diagnosable instead of mysterious.
//
// A patch may only *extend* selector lists and retune bounded values. It
// deliberately cannot express "remove this selector": a provider UI change
// should add a new way to find a control, not delete the way that still works
// for accounts on an older rollout, and a patch that could delete selectors
// would let one bad training cycle blind the agent permanently.
type Patch struct {
	Sequence          int                 `json:"sequence"`
	Revision          string              `json:"revision,omitempty"`
	State             PatchState          `json:"state"`
	Selectors         map[string][]string `json:"selectors,omitempty"`
	OptionalSelectors map[string][]string `json:"optional_selectors,omitempty"`
	Labels            map[string][]string `json:"labels,omitempty"`
	Timing            map[string]int      `json:"timing,omitempty"`

	// Provenance. `Reason` names the failing verb/selector key that motivated
	// the patch; `EvidenceSHA256` points at the stored structural snapshot it
	// was derived from.
	Reason         string `json:"reason,omitempty"`
	EvidenceSHA256 string `json:"evidence_sha256,omitempty"`
	CreatedBy      string `json:"created_by,omitempty"`
	Note           string `json:"note,omitempty"`
}

// Merged reports whether this patch participates in the effective document.
// A rejected patch stays in the chain as history but contributes nothing.
func (p Patch) Merged() bool { return p.State != PatchRejected }

func normalizeList(values []string, limit, maxLen int) []string {
	seen := make(map[string]struct{}, len(values))
	out := make([]string, 0, len(values))
	for _, raw := range values {
		value := strings.TrimSpace(raw)
		if value == "" || len(value) > maxLen {
			continue
		}
		if _, done := seen[value]; done {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
		if len(out) >= limit {
			break
		}
	}
	return out
}

func foldList(values []string) []string {
	lowered := make([]string, 0, len(values))
	for _, value := range values {
		lowered = append(lowered, strings.ToLower(strings.TrimSpace(value)))
	}
	return normalizeList(lowered, maxLabelsPerKey, maxLabelLength)
}

const maxLabelLength = 120

// Validate enforces every rule that keeps a document usable by an agent. It is
// total: a document either validates completely or is rejected, because a
// half-valid document is indistinguishable at runtime from a UI that changed
// shape.
func (d Document) Validate() error {
	var problems []string

	if d.Schema != Schema {
		problems = append(problems, fmt.Sprintf("schema must be %s", Schema))
	}
	if strings.TrimSpace(d.Provider) == "" {
		problems = append(problems, "provider is required")
	}
	if strings.TrimSpace(d.Revision) == "" {
		problems = append(problems, "revision is required")
	}
	if len(normalizeList(d.TrustedHosts, 8, 253)) == 0 {
		problems = append(problems, "trusted_hosts must list at least one host")
	}
	if !strings.HasPrefix(d.BaseURL, "https://") {
		problems = append(problems, "base_url must be https")
	}

	if len(d.Selectors) == 0 {
		problems = append(problems, "selectors must not be empty")
	}
	for _, key := range sortedKeys(d.Selectors) {
		// A required selector with no candidates produces an agent that cannot
		// see the control at all.
		if len(normalizeList(d.Selectors[key], maxSelectorsPerKey, maxSelectorLength)) == 0 {
			problems = append(problems, fmt.Sprintf("selectors.%s must not be empty", key))
		}
	}
	for _, key := range sortedKeys(d.Labels) {
		if len(foldList(d.Labels[key])) == 0 {
			problems = append(problems, fmt.Sprintf("labels.%s must not be empty", key))
		}
	}
	for _, key := range sortedKeys(d.Timing) {
		value := d.Timing[key]
		// A zero budget turns a bounded wait into an instant failure; an
		// unbounded one hangs a slot forever.
		if value < minTimingMs || value > maxTimingMs {
			problems = append(problems, fmt.Sprintf("timing.%s must be within [%d, %d]", key, minTimingMs, maxTimingMs))
		}
	}
	if len(d.EffortLevels) == 0 {
		problems = append(problems, "effort_levels must describe at least one level")
	}
	for _, level := range d.EffortLevels {
		if strings.TrimSpace(level.ID) == "" || len(level.Labels) == 0 {
			problems = append(problems, "every effort level needs an id and at least one label")
			break
		}
	}
	// Without an exclusion set the reasoning extractor would pull code blocks
	// into the visible-reasoning panel, which is exactly what it must not do.
	if len(d.Reasoning.ExcludeWithin) == 0 {
		problems = append(problems, "reasoning.exclude_within must not be empty")
	}
	if d.Reasoning.MaxRows <= 0 || d.Reasoning.MaxRowChars <= 0 || d.Reasoning.MinRowChars < 0 {
		problems = append(problems, "reasoning row bounds must be positive")
	}
	if d.Anomaly.MaxCaptureBytes <= 0 {
		problems = append(problems, "anomaly.max_capture_bytes must be positive")
	}

	if len(problems) > 0 {
		return fmt.Errorf("invalid chat agent behavior: %s", strings.Join(problems, "; "))
	}
	return nil
}

func sortedKeys[T any](values map[string]T) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

// Normalized returns a copy with every list bounded and de-duplicated, so what
// is stored and what is served are the same shape regardless of how the seed or
// an overlay was authored.
func (d Document) Normalized() Document {
	out := d
	out.Provider = strings.TrimSpace(d.Provider)
	out.Revision = strings.TrimSpace(d.Revision)
	out.TrustedHosts = normalizeList(lowerAll(d.TrustedHosts), 8, 253)

	out.Selectors = map[string][]string{}
	for key, list := range d.Selectors {
		out.Selectors[key] = normalizeList(list, maxSelectorsPerKey, maxSelectorLength)
	}
	out.OptionalSelectors = map[string][]string{}
	for key, list := range d.OptionalSelectors {
		out.OptionalSelectors[key] = normalizeList(list, maxSelectorsPerKey, maxSelectorLength)
	}
	out.Labels = map[string][]string{}
	for key, list := range d.Labels {
		out.Labels[key] = foldList(list)
	}
	return out
}

func lowerAll(values []string) []string {
	out := make([]string, 0, len(values))
	for _, value := range values {
		out = append(out, strings.ToLower(strings.TrimSpace(value)))
	}
	return out
}

// applyOne folds a single patch into a working document. Learned candidates
// sort ahead of what is already there because they were observed on the page
// that is actually loaded, while the existing entries remain as the fallback.
func applyOne(doc Document, patch Patch) Document {
	for key, learned := range patch.Selectors {
		if _, known := doc.Selectors[key]; !known {
			// A patch cannot invent a selector key the agent has no verb for.
			continue
		}
		doc.Selectors[key] = normalizeList(append(normalizeList(learned, maxSelectorsPerKey, maxSelectorLength), doc.Selectors[key]...), maxSelectorsPerKey, maxSelectorLength)
	}
	for key, learned := range patch.OptionalSelectors {
		if _, known := doc.OptionalSelectors[key]; !known {
			continue
		}
		doc.OptionalSelectors[key] = normalizeList(append(normalizeList(learned, maxSelectorsPerKey, maxSelectorLength), doc.OptionalSelectors[key]...), maxSelectorsPerKey, maxSelectorLength)
	}
	for key, learned := range patch.Labels {
		if _, known := doc.Labels[key]; !known {
			continue
		}
		doc.Labels[key] = foldList(append(learned, doc.Labels[key]...))
	}
	for key, value := range patch.Timing {
		if _, known := doc.Timing[key]; !known {
			continue
		}
		doc.Timing[key] = value
	}
	if revision := strings.TrimSpace(patch.Revision); revision != "" {
		doc.Revision = revision
		doc.Origin = "learned"
	}
	return doc
}

// Apply folds an ordered patch chain onto the seed and returns the effective
// document plus the patches that were actually merged.
//
// Each step is validated on its own. A patch that would produce an invalid
// document is skipped and reported rather than aborting the chain: one bad
// training cycle must not be able to take the agent offline, and the last known
// good document is always still reachable.
func Apply(seed Document, patches []Patch) (Document, []Patch, []error) {
	effective := seed.Normalized()
	if err := effective.Validate(); err != nil {
		return Document{}, nil, []error{fmt.Errorf("seed document is invalid: %w", err)}
	}

	ordered := append([]Patch(nil), patches...)
	sort.SliceStable(ordered, func(i, j int) bool { return ordered[i].Sequence < ordered[j].Sequence })

	var merged []Patch
	var problems []error
	for _, patch := range ordered {
		if !patch.Merged() {
			continue
		}
		candidate := applyOne(cloneDocument(effective), patch)
		if err := candidate.Validate(); err != nil {
			problems = append(problems, fmt.Errorf("patch %d (%s) produced an invalid document: %w", patch.Sequence, patch.Reason, err))
			continue
		}
		effective = candidate
		merged = append(merged, patch)
	}
	return effective, merged, problems
}

// cloneDocument deep-copies the mutable maps so a rejected patch leaves no
// trace on the document the chain continues from.
func cloneDocument(doc Document) Document {
	out := doc
	out.Selectors = cloneMap(doc.Selectors)
	out.OptionalSelectors = cloneMap(doc.OptionalSelectors)
	out.Labels = cloneMap(doc.Labels)
	out.Timing = make(map[string]int, len(doc.Timing))
	for key, value := range doc.Timing {
		out.Timing[key] = value
	}
	return out
}

func cloneMap(source map[string][]string) map[string][]string {
	out := make(map[string][]string, len(source))
	for key, list := range source {
		out[key] = append([]string(nil), list...)
	}
	return out
}

var ErrUnknownProvider = errors.New("no seeded chat agent behavior for provider")
