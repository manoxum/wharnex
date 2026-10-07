package exchange

import (
	"fmt"

	"kernl.local/harness/backend/internal/uitesting/guidedoc"
)

const (
	maxGuideSections = 10
	maxGuideSteps    = 40
)

// resolveGuide validates the answer's content and turns every annotation and
// crop into geometry on the real capture.
func resolveGuide(answer GuideAnswer, binding GuideBinding) (guidedoc.Document, error) {
	doc := guidedoc.Document{Version: guidedoc.Version, Theme: answer.Theme, DurationMinutes: answer.DurationMinutes,
		Environment: binding.EnvironmentName, Profile: binding.Profile}
	var err error
	fields := []struct {
		target   *string
		name     string
		value    string
		required bool
		limit    int
	}{{&doc.Title, "title", answer.Title, true, 120}, {&doc.Subtitle, "subtitle", answer.Subtitle, false, 220}, {&doc.Summary, "summary", answer.Summary, true, 800},
		{&doc.Audience, "audience", answer.Audience, true, 400}, {&doc.ExpectedResult, "expected_result", answer.ExpectedResult, true, 800}}
	for _, field := range fields {
		if *field.target, err = text(field.name, field.value, field.required, field.limit); err != nil {
			return doc, err
		}
	}
	if !guidedoc.OneOf(doc.Theme.Accent, guidedoc.Accents) || !guidedoc.OneOf(doc.Theme.Cover, guidedoc.Covers) {
		return doc, fmt.Errorf("theme.accent must be one of %v and theme.cover one of %v", guidedoc.Accents, guidedoc.Covers)
	}
	if doc.DurationMinutes < 0 || doc.DurationMinutes > 120 {
		return doc, fmt.Errorf("duration_minutes must be 0..120")
	}
	if doc.BeforeYouStart, err = textList("before_you_start", answer.BeforeYouStart, 8, 240); err != nil {
		return doc, err
	}
	if doc.Related, err = textList("related", answer.Related, 8, 160); err != nil {
		return doc, err
	}
	if len(answer.Troubleshooting) > 8 {
		return doc, fmt.Errorf("troubleshooting holds at most 8 items")
	}
	for _, item := range answer.Troubleshooting {
		problem, err1 := text("troubleshooting.problem", item.Problem, true, 200)
		solution, err2 := text("troubleshooting.solution", item.Solution, true, 400)
		if err1 != nil || err2 != nil {
			return doc, fmt.Errorf("troubleshooting items need a problem (≤200) and a solution (≤400)")
		}
		doc.Troubleshooting = append(doc.Troubleshooting, guidedoc.Trouble{Problem: problem, Solution: solution})
	}
	doc.Sections, err = resolveSections(answer.Sections, binding)
	return doc, err
}

func resolveSections(sections []AnswerSection, binding GuideBinding) ([]guidedoc.Section, error) {
	if len(sections) == 0 || len(sections) > maxGuideSections {
		return nil, fmt.Errorf("sections must hold 1..%d sections", maxGuideSections)
	}
	order := map[string]int{}
	for i, frame := range binding.Frames {
		order[frame.Capture.Name] = i + 1
	}
	last, total, shown := 0, 0, 0
	out := []guidedoc.Section{}
	for _, section := range sections {
		title, err := text("sections.title", section.Title, true, 90)
		if err != nil {
			return nil, err
		}
		intro, err := text("sections.intro", section.Intro, false, 400)
		if err != nil {
			return nil, err
		}
		if len(section.Steps) == 0 {
			return nil, fmt.Errorf("section %q has no steps", title)
		}
		resolved := guidedoc.Section{Title: title, Intro: intro}
		for _, step := range section.Steps {
			total++
			frame := GuideFrame{}
			if step.Capture != "" {
				position := order[step.Capture]
				if position == 0 || position <= last {
					return nil, fmt.Errorf("step %d: capture %q is unknown, repeated or out of order; each capture appears at most once, in the order taken", total, step.Capture)
				}
				last, frame = position, binding.Frames[position-1]
				shown++
			}
			item, err := resolveStep(total, step, frame)
			if err != nil {
				return nil, err
			}
			resolved.Steps = append(resolved.Steps, item)
		}
		out = append(out, resolved)
	}
	if total > maxGuideSteps {
		return nil, fmt.Errorf("the guide holds at most %d steps", maxGuideSteps)
	}
	if shown == 0 && len(binding.Frames) > 0 {
		return nil, fmt.Errorf("the guide must show at least one capture")
	}
	return out, nil
}

func resolveStep(number int, step AnswerStep, frame GuideFrame) (guidedoc.Step, error) {
	fail := func(format string, args ...any) (guidedoc.Step, error) {
		return guidedoc.Step{}, fmt.Errorf("step %d: "+format, append([]any{number}, args...)...)
	}
	title, err := text("title", step.Title, true, 100)
	if err != nil {
		return fail("%v", err)
	}
	instructions, err := textList("instructions", step.Instructions, 6, 260)
	if err != nil || len(instructions) == 0 {
		return fail("needs 1..6 instructions of at most 260 characters")
	}
	if !guidedoc.OneOf(step.Layout, guidedoc.Layouts) {
		return fail("layout must be one of %v", guidedoc.Layouts)
	}
	out := guidedoc.Step{Title: title, Instructions: instructions, Layout: step.Layout, Region: guidedoc.Full()}
	if step.Callout != nil {
		calloutText, err := text("callout.text", step.Callout.Text, true, 300)
		if err != nil || !guidedoc.OneOf(step.Callout.Kind, guidedoc.CalloutKinds) {
			return fail("callout needs a kind in %v and a text of at most 300 characters", guidedoc.CalloutKinds)
		}
		out.Callout = &guidedoc.Callout{Kind: step.Callout.Kind, Text: calloutText}
	}
	if step.Capture == "" {
		if len(step.Annotations) > 0 || step.Region != nil {
			return fail("annotations and region need a capture")
		}
		return out, nil
	}
	capture := frame.Capture
	out.Capture = &capture
	if out.Caption, err = text("caption", step.Caption, true, 300); err != nil {
		return fail("%v", err)
	}
	if out.Annotations, err = resolveMarks(step.Annotations, frame); err != nil {
		return fail("%v", err)
	}
	out.Region, err = resolveRegion(step, out.Annotations, capture)
	if err != nil {
		return fail("%v", err)
	}
	return out, nil
}
