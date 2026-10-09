package exchange

import (
	"fmt"
	"strings"
	"unicode/utf8"
)

// GuideRequestProtocolV1 requests are no longer issued; an answer to one that
// was already in flight across a deploy is still accepted.
const (
	GuideRequestProtocolV1 = "wharnex.ui-test-guide-input/v1"
	GuideResultProtocolV1  = "wharnex.ui-test-guide/v1"
	guideManifestV1        = "manifest.json"
	guideMarkdownV1        = "guide.md"
)

// GuideAnswerV1 is the manifest of a v1 guide response; the guide is guide.md.
type GuideAnswerV1 struct {
	Protocol    string            `json:"protocol"`
	Task        string            `json:"task"`
	TaskID      string            `json:"task_id"`
	RunID       string            `json:"run_id"`
	InputSHA256 string            `json:"input_sha256"`
	Title       string            `json:"title"`
	Captions    map[string]string `json:"captions"`
	Verdict     GuideVerdict      `json:"verdict"`
}

func parseGuideAnswerV1(filename string, bundle []byte, m Manifest, screenshots []string) (GuideResult, error) {
	entries, err := readAnswer(filename, bundle, m, map[string]int{guideManifestV1: 64 << 10, guideMarkdownV1: 512 << 10})
	if err != nil {
		return GuideResult{}, err
	}
	var answer GuideAnswerV1
	if err := decodeStrict(entries[guideManifestV1], &answer); err != nil {
		return GuideResult{}, err
	}
	if answer.Protocol != GuideResultProtocolV1 || answer.Task != GuideTask || answer.TaskID != m.TaskID || answer.RunID != m.RunID || answer.InputSHA256 != m.InputSHA256 {
		return GuideResult{}, fmt.Errorf("UI guide answer does not match its request")
	}
	result := GuideResult{Title: strings.TrimSpace(answer.Title), Markdown: string(entries[guideMarkdownV1]), Verdict: answer.Verdict}
	if result.Title == "" || len(result.Title) > 200 || !utf8.ValidString(result.Markdown) || strings.TrimSpace(result.Markdown) == "" {
		return GuideResult{}, fmt.Errorf("UI guide answer has an invalid title or guide")
	}
	if result.Captions, err = captionsFor(answer.Captions, screenshots); err != nil {
		return GuideResult{}, err
	}
	for _, name := range screenshots {
		if !strings.Contains(result.Markdown, "]("+name+")") {
			return GuideResult{}, fmt.Errorf("the guide must show every capture in order: %s is not referenced as ![legenda](%s)", name, name)
		}
	}
	return result, validateVerdict(result.Verdict)
}

// captionsFor requires a legend for every capture sent, and only for those.
func captionsFor(captions map[string]string, screenshots []string) (map[string]string, error) {
	out := map[string]string{}
	for _, name := range screenshots {
		caption := strings.TrimSpace(captions[name])
		if caption == "" || len(caption) > 400 {
			return nil, fmt.Errorf("captions must give every capture (%s) a legend of at most 400 characters", name)
		}
		out[name] = caption
	}
	if len(captions) > len(screenshots) {
		return nil, fmt.Errorf("captions name captures that were not sent")
	}
	return out, nil
}

func validateVerdict(verdict GuideVerdict) error {
	if (verdict.Status != "passed" && verdict.Status != "failed") || strings.TrimSpace(verdict.Reason) == "" || len(verdict.Reason) > 600 {
		return fmt.Errorf("verdict must be passed or failed with a reason of at most 600 characters")
	}
	return nil
}
