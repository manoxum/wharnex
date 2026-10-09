package exchange

import (
	"bytes"
	"encoding/json"
	"fmt"
)

var actionNames = map[string]bool{"navigate": true, "click": true, "fill": true, "fill_credential": true, "press": true, "wait": true, "assert_text": true, "finish": true}

type flatAction Action

// UnmarshalJSON accepts the canonical flat form {"action":"click","selector":…}
// and the unambiguous nested form {"click":{"selector":…},"caption":…} that a
// model sometimes writes from the `click{selector}` notation. Both decode
// strictly; anything else is refused.
func (a *Action) UnmarshalJSON(raw []byte) error {
	var keys map[string]json.RawMessage
	if err := json.Unmarshal(raw, &keys); err != nil {
		return fmt.Errorf("UI action must be an object: %w", err)
	}
	if _, flat := keys["action"]; !flat {
		name, params := "", json.RawMessage(nil)
		for key, value := range keys {
			if actionNames[key] {
				if name != "" {
					return fmt.Errorf("UI action names more than one action")
				}
				name, params = key, value
			} else if key != "caption" {
				return fmt.Errorf("UI action has an unknown field %q", key)
			}
		}
		if name == "" {
			return fmt.Errorf("UI action has no action")
		}
		merged := map[string]json.RawMessage{}
		if len(bytes.TrimSpace(params)) > 0 && !bytes.Equal(bytes.TrimSpace(params), []byte("null")) {
			if err := json.Unmarshal(params, &merged); err != nil {
				return fmt.Errorf("UI action %s parameters must be an object", name)
			}
		}
		merged["action"], _ = json.Marshal(name)
		if caption, ok := keys["caption"]; ok {
			if _, own := merged["caption"]; !own {
				merged["caption"] = caption
			}
		}
		raw, _ = json.Marshal(merged)
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var out flatAction
	if err := decoder.Decode(&out); err != nil {
		return fmt.Errorf("decode UI action: %w", err)
	}
	*a = Action(out)
	return nil
}
