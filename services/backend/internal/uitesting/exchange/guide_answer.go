package exchange

import (
	"fmt"
	"strings"

	"kernl.local/harness/backend/internal/uitesting"
	"kernl.local/harness/backend/internal/uitesting/guidedoc"
)

const maxProposedTests = 12

type GuideVerdict struct {
	Status string `json:"status"`
	Reason string `json:"reason"`
}

// GuideAnswer is guide.json, the only entry of a v2 guide response: the guide
// content and design choices, the legend of every capture, the visual verdict
// and tests proposed for elements the plan does not exercise yet.
type GuideAnswer struct {
	Protocol        string               `json:"protocol"`
	Task            string               `json:"task"`
	TaskID          string               `json:"task_id"`
	RunID           string               `json:"run_id"`
	InputSHA256     string               `json:"input_sha256"`
	Title           string               `json:"title"`
	Subtitle        string               `json:"subtitle"`
	Summary         string               `json:"summary"`
	Audience        string               `json:"audience"`
	DurationMinutes int                  `json:"duration_minutes"`
	Theme           guidedoc.Theme       `json:"theme"`
	BeforeYouStart  []string             `json:"before_you_start"`
	Sections        []AnswerSection      `json:"sections"`
	ExpectedResult  string               `json:"expected_result"`
	Troubleshooting []guidedoc.Trouble   `json:"troubleshooting"`
	Related         []string             `json:"related"`
	Captions        map[string]string    `json:"captions"`
	ProposedTests   []uitesting.TestCase `json:"proposed_tests"`
	Verdict         GuideVerdict         `json:"verdict"`
}

type AnswerSection struct {
	Title string       `json:"title"`
	Intro string       `json:"intro,omitempty"`
	Steps []AnswerStep `json:"steps"`
}

type AnswerStep struct {
	Title        string            `json:"title"`
	Instructions []string          `json:"instructions"`
	Layout       string            `json:"layout"`
	Capture      string            `json:"capture,omitempty"`
	View         string            `json:"view,omitempty"`
	Region       *guidedoc.Rect    `json:"region,omitempty"`
	Annotations  []AnswerMark      `json:"annotations,omitempty"`
	Caption      string            `json:"caption,omitempty"`
	Callout      *guidedoc.Callout `json:"callout,omitempty"`
}

type AnswerMark struct {
	Element string         `json:"element,omitempty"`
	Region  *guidedoc.Rect `json:"region,omitempty"`
	Label   string         `json:"label"`
}

// GuideResult is a validated guide answer. Document is absent only for an
// answer to a v1 request, whose guide is free Markdown.
type GuideResult struct {
	Title         string               `json:"title"`
	Markdown      string               `json:"markdown"`
	Captions      map[string]string    `json:"captions"`
	Verdict       GuideVerdict         `json:"verdict"`
	Document      *guidedoc.Document   `json:"document,omitempty"`
	ProposedTests []uitesting.TestCase `json:"proposed_tests,omitempty"`
}

// ParseGuideAnswer validates a guide response against the request issued.
func ParseGuideAnswer(filename string, bundle []byte, m Manifest, binding GuideBinding) (GuideResult, error) {
	if m.Protocol == GuideRequestProtocolV1 {
		return parseGuideAnswerV1(filename, bundle, m, binding.Screenshots)
	}
	entries, err := readAnswer(filename, bundle, m, map[string]int{guideAnswerPath: 1 << 20})
	if err != nil {
		return GuideResult{}, err
	}
	var answer GuideAnswer
	if err := decodeStrict(entries[guideAnswerPath], &answer); err != nil {
		return GuideResult{}, err
	}
	if answer.Protocol != GuideResultProtocol || answer.Task != GuideTask || answer.TaskID != m.TaskID || answer.RunID != m.RunID || answer.InputSHA256 != m.InputSHA256 {
		return GuideResult{}, fmt.Errorf("UI guide answer does not match its request")
	}
	doc, err := resolveGuide(answer, binding)
	if err != nil {
		return GuideResult{}, err
	}
	captions, err := captionsFor(answer.Captions, binding.Screenshots)
	if err != nil {
		return GuideResult{}, err
	}
	if err := validateVerdict(answer.Verdict); err != nil {
		return GuideResult{}, err
	}
	if err := validateProposals(answer.ProposedTests, binding.EnvironmentID); err != nil {
		return GuideResult{}, err
	}
	doc.Outcome = "failed"
	if binding.RunStatus == "passed" && answer.Verdict.Status == "passed" {
		doc.Outcome = "passed"
	}
	return GuideResult{Title: doc.Title, Markdown: guidedoc.Markdown(doc), Captions: captions, Verdict: answer.Verdict, Document: &doc, ProposedTests: answer.ProposedTests}, nil
}

// validateProposals keeps proposed tests inside the environment that was run:
// that environment is the one already proven testable in a web browser.
func validateProposals(tests []uitesting.TestCase, environmentID string) error {
	if len(tests) > maxProposedTests {
		return fmt.Errorf("proposed_tests holds at most %d tests", maxProposedTests)
	}
	for _, test := range tests {
		if test.EnvironmentID != environmentID {
			return fmt.Errorf("proposed test %q must use environment_id %q, the web environment that was tested", test.ID, environmentID)
		}
	}
	return uitesting.ValidateProposedTests(tests)
}

// text checks a required or optional human-facing string against its bound.
func text(field, value string, required bool, limit int) (string, error) {
	value = strings.TrimSpace(value)
	if (required && value == "") || len(value) > limit {
		return "", fmt.Errorf("%s is required and holds at most %d characters", field, limit)
	}
	return value, nil
}

func textList(field string, values []string, maxItems, limit int) ([]string, error) {
	if len(values) > maxItems {
		return nil, fmt.Errorf("%s holds at most %d items", field, maxItems)
	}
	out := []string{}
	for _, value := range values {
		item, err := text(field, value, true, limit)
		if err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, nil
}
