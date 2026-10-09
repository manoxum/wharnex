// Package guidedoc is the structured user guide of a UI Lab test. GPT authors
// its content and design choices from closed sets; the exchange engine
// validates it and resolves every annotation and crop to concrete geometry,
// so this package holds no provider trust. It is also the single renderer of
// a guide: the Markdown read in the manual and the HTML that is shown, opened
// in a browser and printed to PDF all come from the same document.
package guidedoc

// Version is the document layout this package renders.
const Version = 2

// Layouts are the step compositions a guide may choose from.
var Layouts = []string{"split", "hero", "focus", "compact"}

// Accents are the guide colour themes.
var Accents = []string{"indigo", "violet", "emerald", "teal", "sky", "amber", "rose"}

// Covers are the cover-page styles.
var Covers = []string{"aurora", "mesh", "minimal", "split"}

// CalloutKinds are the highlighted boxes a step may carry.
var CalloutKinds = []string{"tip", "note", "warning", "success"}

// Rect is a box in fractions (0..1) of a capture's width and height.
type Rect struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	W float64 `json:"w"`
	H float64 `json:"h"`
}

// Capture names one screenshot of the run and its pixel size.
type Capture struct {
	Name   string `json:"name"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
}

// Annotation is one numbered marker drawn over a capture, with its legend.
type Annotation struct {
	Number int    `json:"number"`
	Label  string `json:"label"`
	Box    Rect   `json:"box"`
}

type Callout struct {
	Kind string `json:"kind"`
	Text string `json:"text"`
}

// Step is one instruction of the guide. A step with a capture shows Region
// of it (the whole capture when unfocused) with its annotations.
type Step struct {
	Title        string       `json:"title"`
	Instructions []string     `json:"instructions"`
	Layout       string       `json:"layout"`
	Capture      *Capture     `json:"capture,omitempty"`
	Region       Rect         `json:"region"`
	Annotations  []Annotation `json:"annotations,omitempty"`
	Caption      string       `json:"caption,omitempty"`
	Callout      *Callout     `json:"callout,omitempty"`
}

type Section struct {
	Title string `json:"title"`
	Intro string `json:"intro,omitempty"`
	Steps []Step `json:"steps"`
}

type Trouble struct {
	Problem  string `json:"problem"`
	Solution string `json:"solution"`
}

type Theme struct {
	Accent string `json:"accent"`
	Cover  string `json:"cover"`
}

// Document is a validated, resolved guide. Environment, Profile and Outcome
// come from the engine, never from GPT.
type Document struct {
	Version         int       `json:"version"`
	Title           string    `json:"title"`
	Subtitle        string    `json:"subtitle,omitempty"`
	Summary         string    `json:"summary"`
	Audience        string    `json:"audience"`
	Environment     string    `json:"environment,omitempty"`
	Profile         string    `json:"profile,omitempty"`
	Outcome         string    `json:"outcome,omitempty"`
	DurationMinutes int       `json:"duration_minutes,omitempty"`
	Theme           Theme     `json:"theme"`
	BeforeYouStart  []string  `json:"before_you_start,omitempty"`
	Sections        []Section `json:"sections"`
	ExpectedResult  string    `json:"expected_result"`
	Troubleshooting []Trouble `json:"troubleshooting,omitempty"`
	Related         []string  `json:"related,omitempty"`
}

// Captures lists, in order, the captures the guide shows.
func (d Document) Captures() []string {
	names := []string{}
	for _, section := range d.Sections {
		for _, step := range section.Steps {
			if step.Capture != nil {
				names = append(names, step.Capture.Name)
			}
		}
	}
	return names
}

// OneOf reports whether value is in set.
func OneOf(value string, set []string) bool {
	for _, item := range set {
		if item == value {
			return true
		}
	}
	return false
}
