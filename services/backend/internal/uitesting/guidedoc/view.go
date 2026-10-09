package guidedoc

import (
	"fmt"
	"html/template"
	"strings"
)

type pageView struct {
	Document
	CSS          template.CSS
	JS           template.JS
	Chapters     []chapterView
	StepCount    int
	OutcomeLabel string
}

type chapterView struct {
	Number int
	Anchor string
	Title  string
	Intro  string
	Steps  []stepView
}

type stepView struct {
	Number       int
	Anchor       string
	Title        string
	Instructions []string
	Layout       string
	Side         string
	Image        bool
	Src          template.URL
	Alt          string
	Frame        template.CSS
	Img          template.CSS
	Focused      bool
	Marks        []markView
	FullMarks    string
	Caption      string
	Callout      *Callout
	CalloutTitle string
}

type markView struct {
	Number int
	Label  string
	Box    template.CSS
}

// newView lays the document out. Consecutive split steps alternate their
// image side, so a long guide never reads as one repeated block.
func newView(d Document, source ImageSource) pageView {
	view := pageView{Document: d, OutcomeLabel: outcomeLabel(d.Outcome)}
	number, splits := 0, 0
	for i, sec := range d.Sections {
		chapter := chapterView{Number: i + 1, Anchor: fmt.Sprintf("capitulo-%d", i+1), Title: sec.Title, Intro: sec.Intro}
		for _, step := range sec.Steps {
			number++
			item := stepView{Number: number, Anchor: fmt.Sprintf("passo-%d", number), Title: step.Title, Instructions: step.Instructions,
				Layout: step.Layout, Side: "end", Caption: step.Caption, Callout: step.Callout}
			if !OneOf(item.Layout, Layouts) {
				item.Layout = "split"
			}
			if item.Layout == "split" {
				if splits%2 == 1 {
					item.Side = "start"
				}
				splits++
			}
			if step.Callout != nil {
				item.CalloutTitle = calloutTitle(step.Callout.Kind)
			}
			if step.Capture != nil {
				shot(&item, step, source)
			}
			chapter.Steps = append(chapter.Steps, item)
		}
		view.Chapters = append(view.Chapters, chapter)
	}
	view.StepCount = number
	return view
}

// shot places the capture so only its region shows, and the markers in that
// region's coordinates; the lightbox gets the markers on the whole capture.
func shot(item *stepView, step Step, source ImageSource) {
	region := step.Region
	if !region.Valid() {
		region = Full()
	}
	capture := step.Capture
	item.Image, item.Src, item.Alt, item.Focused = true, source(capture.Name), step.Caption, !region.IsFull()
	item.Frame = template.CSS(fmt.Sprintf("aspect-ratio:%.1f/%.1f", region.W*float64(capture.Width), region.H*float64(capture.Height)))
	item.Img = template.CSS(fmt.Sprintf("width:%s;left:%s;top:%s", percent(1/region.W), percent(-region.X/region.W), percent(-region.Y/region.H)))
	full := []string{}
	for _, mark := range step.Annotations {
		box := Within(mark.Box, region)
		item.Marks = append(item.Marks, markView{Number: mark.Number, Label: mark.Label,
			Box: template.CSS(fmt.Sprintf("left:%s;top:%s;width:%s;height:%s", percent(box.X), percent(box.Y), percent(box.W), percent(box.H)))})
		full = append(full, fmt.Sprintf("%d,%.4f,%.4f,%.4f,%.4f", mark.Number, mark.Box.X, mark.Box.Y, mark.Box.W, mark.Box.H))
	}
	item.FullMarks = strings.Join(full, ";")
}

func percent(fraction float64) string { return fmt.Sprintf("%.3f%%", fraction*100) }

func outcomeLabel(outcome string) string {
	switch outcome {
	case "passed":
		return "Verificado numa execução real"
	case "failed":
		return "Execução com falhas"
	default:
		return ""
	}
}
