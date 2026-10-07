package exchange

import (
	"fmt"

	"kernl.local/harness/backend/internal/uitesting/guidedoc"
)

const (
	maxStepMarks    = 6
	minExplicitCrop = 0.2
)

// resolveMarks numbers a step's annotations and places each on its measured
// element, or on the region GPT gave for something the page did not list.
func resolveMarks(marks []AnswerMark, frame GuideFrame) ([]guidedoc.Annotation, error) {
	if len(marks) == 0 || len(marks) > maxStepMarks {
		return nil, fmt.Errorf("a step with a capture marks 1..%d elements in annotations", maxStepMarks)
	}
	out := []guidedoc.Annotation{}
	for i, mark := range marks {
		label, err := text("annotations.label", mark.Label, true, 90)
		if err != nil {
			return nil, err
		}
		var box guidedoc.Rect
		switch {
		case mark.Element != "" && mark.Region == nil:
			element, found := findElement(frame, mark.Element)
			if !found {
				return nil, fmt.Errorf("annotation %d names element %q, which is not in %s", i+1, mark.Element, frame.Capture.Name)
			}
			box = element.Box
		case mark.Element == "" && mark.Region != nil && mark.Region.Valid():
			box = *mark.Region
		default:
			return nil, fmt.Errorf("annotation %d needs exactly one of element or a valid region", i+1)
		}
		out = append(out, guidedoc.Annotation{Number: i + 1, Label: label, Box: box})
	}
	return out, nil
}

// resolveRegion focuses on the marked elements unless the step asks for the
// whole screen; an explicit crop must keep every marker inside it.
func resolveRegion(step AnswerStep, marks []guidedoc.Annotation, capture guidedoc.Capture) (guidedoc.Rect, error) {
	switch step.View {
	case "full":
		return guidedoc.Full(), nil
	case "focus":
	default:
		return guidedoc.Rect{}, fmt.Errorf("view must be focus or full")
	}
	boxes := []guidedoc.Rect{}
	for _, mark := range marks {
		boxes = append(boxes, mark.Box)
	}
	if step.Region == nil {
		return guidedoc.FocusOn(boxes, capture.Width, capture.Height), nil
	}
	region := *step.Region
	if !region.Valid() || region.W < minExplicitCrop || region.H < minExplicitCrop {
		return guidedoc.Rect{}, fmt.Errorf("region must lie inside the capture and cover at least %.0f%% of each side", minExplicitCrop*100)
	}
	for _, box := range boxes {
		if x, y := box.Center(); !region.Contains(x, y) {
			return guidedoc.Rect{}, fmt.Errorf("region must contain every annotated element")
		}
	}
	return guidedoc.Fit(region, capture.Width, capture.Height), nil
}
