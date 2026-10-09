package exchange

import (
	"bytes"
	"fmt"
	"image/png"
	"math"
	"sort"

	"kernl.local/harness/backend/internal/uitesting"
	"kernl.local/harness/backend/internal/uitesting/guidedoc"
)

const maxFrameElements = 60

// GuideElement is one element visible on a capture that the guide may mark.
// Box is measured by the Desktop on the page under test, so a marker lands on
// the real control rather than where GPT guesses it is.
type GuideElement struct {
	ID      string        `json:"id"`
	Tag     string        `json:"tag"`
	Role    string        `json:"role,omitempty"`
	Label   string        `json:"label,omitempty"`
	Text    string        `json:"text,omitempty"`
	ActedOn bool          `json:"acted_on,omitempty"`
	Box     guidedoc.Rect `json:"box"`
}

// GuideFrame is one capture with its markable elements.
type GuideFrame struct {
	Capture  guidedoc.Capture `json:"capture"`
	Caption  string           `json:"caption,omitempty"`
	Elements []GuideElement   `json:"elements"`
}

// guideFrames measures every capture and keeps, per capture, the elements
// inside the viewport: the ones a step acted on first, then in page order.
func guideFrames(shots []Screenshot, steps []uitesting.Step) ([]GuideFrame, error) {
	acted := map[string]map[string]bool{}
	for _, step := range steps {
		if step.Screenshot != "" && step.Selector != "" {
			if acted[step.Screenshot] == nil {
				acted[step.Screenshot] = map[string]bool{}
			}
			acted[step.Screenshot][step.Selector] = true
		}
	}
	frames := make([]GuideFrame, 0, len(shots))
	for _, shot := range shots {
		config, err := png.DecodeConfig(bytes.NewReader(shot.PNG))
		if err != nil || config.Width <= 0 || config.Height <= 0 {
			return nil, fmt.Errorf("UI guide screenshot %q is not a PNG", shot.Name)
		}
		frame := GuideFrame{Capture: guidedoc.Capture{Name: shot.Name, Width: config.Width, Height: config.Height}, Caption: shot.Caption, Elements: []GuideElement{}}
		for _, element := range boundElements(shot.Elements) {
			box, visible := clipToView(element.Rect)
			if !visible {
				continue
			}
			label := element.Label
			if label == "" {
				label = element.Placeholder
			}
			frame.Elements = append(frame.Elements, GuideElement{Tag: element.Tag, Role: element.Role, Label: label, Text: element.Text,
				ActedOn: acted[shot.Name][element.Selector], Box: box})
		}
		sort.SliceStable(frame.Elements, func(i, j int) bool { return frame.Elements[i].ActedOn && !frame.Elements[j].ActedOn })
		if len(frame.Elements) > maxFrameElements {
			frame.Elements = frame.Elements[:maxFrameElements]
		}
		for i := range frame.Elements {
			frame.Elements[i].ID = fmt.Sprintf("e%d", i+1)
		}
		frames = append(frames, frame)
	}
	return frames, nil
}

// clipToView keeps the part of a measured box inside the captured viewport.
func clipToView(rect *guidedoc.Rect) (guidedoc.Rect, bool) {
	if rect == nil {
		return guidedoc.Rect{}, false
	}
	left, top := math.Max(rect.X, 0), math.Max(rect.Y, 0)
	right, bottom := math.Min(rect.X+rect.W, 1), math.Min(rect.Y+rect.H, 1)
	box := guidedoc.Rect{X: round4(left), Y: round4(top), W: round4(right - left), H: round4(bottom - top)}
	return box, box.W >= 0.004 && box.H >= 0.004 && box.Valid()
}

func round4(value float64) float64 { return math.Round(value*10000) / 10000 }

func findElement(frame GuideFrame, id string) (GuideElement, bool) {
	for _, element := range frame.Elements {
		if element.ID == id {
			return element, true
		}
	}
	return GuideElement{}, false
}
