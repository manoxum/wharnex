package exchange

import "kernl.local/harness/backend/internal/uitesting/guidedoc"

// PageElement is one interactive element (or landmark such as a heading or an
// alert) of the page under test, captured by the Desktop. It is untrusted
// page data: bounded here and never executed. Rect is its box in fractions of
// the viewport the capture shows.
type PageElement struct {
	Selector    string         `json:"selector"`
	Tag         string         `json:"tag"`
	Type        string         `json:"type,omitempty"`
	Role        string         `json:"role,omitempty"`
	Label       string         `json:"label,omitempty"`
	Text        string         `json:"text,omitempty"`
	Placeholder string         `json:"placeholder,omitempty"`
	Disabled    bool           `json:"disabled,omitempty"`
	Rect        *guidedoc.Rect `json:"rect,omitempty"`
}

const maxElements = 200

func boundElements(elements []PageElement) []PageElement {
	if len(elements) > maxElements {
		elements = elements[:maxElements]
	}
	out := make([]PageElement, 0, len(elements))
	for _, item := range elements {
		if item.Selector == "" || len(item.Selector) > 300 {
			continue
		}
		var rect *guidedoc.Rect
		if item.Rect != nil {
			bounded := guidedoc.Rect{X: round4(item.Rect.X), Y: round4(item.Rect.Y), W: round4(item.Rect.W), H: round4(item.Rect.H)}
			rect = &bounded
		}
		out = append(out, PageElement{Selector: item.Selector, Tag: clip(item.Tag, 20), Type: clip(item.Type, 30), Role: clip(item.Role, 40),
			Label: clip(item.Label, 120), Text: clip(item.Text, 120), Placeholder: clip(item.Placeholder, 120), Disabled: item.Disabled, Rect: rect})
	}
	return out
}

func clip(value string, limit int) string {
	if len(value) <= limit {
		return value
	}
	return value[:limit]
}
