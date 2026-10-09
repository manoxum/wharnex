// Package textlist decodes lists of short human-facing strings tolerantly.
package textlist

import (
	"bytes"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

// List is a list of short human-facing strings (preconditions, test data,
// tags). GPT sometimes writes an item as a flat object such as
// {"campo":"Nome","valor":"WHX"}; that is the same information, so it is
// normalized to "campo: Nome; valor: WHX" rather than rejected. Nested
// structures are still refused.
type List []string

func (l *List) UnmarshalJSON(raw []byte) error {
	if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		*l = nil
		return nil
	}
	var items []json.RawMessage
	if err := json.Unmarshal(raw, &items); err != nil {
		return fmt.Errorf("text list must be an array: %w", err)
	}
	out := make(List, 0, len(items))
	for _, item := range items {
		text, err := textItem(item)
		if err != nil {
			return err
		}
		out = append(out, text)
	}
	*l = out
	return nil
}

func textItem(raw json.RawMessage) (string, error) {
	var text string
	if json.Unmarshal(raw, &text) == nil {
		return text, nil
	}
	var object map[string]any
	if err := json.Unmarshal(raw, &object); err != nil {
		var scalar any
		if json.Unmarshal(raw, &scalar) == nil && scalar != nil {
			if _, nested := scalar.([]any); !nested {
				return fmt.Sprint(scalar), nil
			}
		}
		return "", fmt.Errorf("text list item must be a string or a flat object")
	}
	keys := make([]string, 0, len(object))
	for key := range object {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, key := range keys {
		switch value := object[key].(type) {
		case map[string]any, []any:
			return "", fmt.Errorf("text list item %q must not nest structures", key)
		case nil:
			continue
		default:
			parts = append(parts, key+": "+fmt.Sprint(value))
		}
	}
	return strings.Join(parts, "; "), nil
}
