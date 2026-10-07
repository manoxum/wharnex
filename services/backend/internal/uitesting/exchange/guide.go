package exchange

import (
	"encoding/json"
	"fmt"
	"regexp"

	"kernl.local/harness/backend/internal/uitesting"
)

const (
	guidePromptPath  = "prompt/wharnex-ui-test-guide-prompt.md"
	guideStatePath   = "state/steps.json"
	guidePlannedPath = "catalog/planned-tests.json"
	guideAnswerPath  = "guide.json"
	maxGuideShots    = 30
	maxGuideBytes    = 20 << 20
	maxPlannedTests  = 300
)

var screenshotName = regexp.MustCompile(`^step-[0-9]{2}\.png$`)

// Screenshot is one capture the guide may show, with the elements measured on
// the page when it was taken.
type Screenshot struct {
	Name     string
	Caption  string
	PNG      []byte
	Elements []PageElement
}

type GuideInput struct {
	TaskID, RunID   string
	Test            uitesting.TestCase
	Prerequisites   []string
	EnvironmentID   string
	EnvironmentName string
	EnvironmentInfo string
	ProfileLabel    string
	Status          string
	PreviousError   string
	Steps           []uitesting.Step
	Screenshots     []Screenshot
	// Planned is the environment's current test plan, which the guide review
	// checks for elements no test exercises yet.
	Planned []uitesting.TestCase
}

// GuideBinding is kept with the issued request: the captures and elements an
// answer may reference, and the identity it must stay within.
type GuideBinding struct {
	Screenshots     []string     `json:"screenshots"`
	Frames          []GuideFrame `json:"frames"`
	EnvironmentID   string       `json:"environment_id"`
	EnvironmentName string       `json:"environment_name,omitempty"`
	Profile         string       `json:"profile,omitempty"`
	RunStatus       string       `json:"run_status,omitempty"`
}

type guideState struct {
	Test          uitesting.TestCase `json:"test"`
	Prerequisites []string           `json:"prerequisites"`
	EnvironmentID string             `json:"environment_id"`
	Environment   string             `json:"environment"`
	About         string             `json:"environment_description,omitempty"`
	Profile       string             `json:"profile"`
	Status        string             `json:"status"`
	PreviousError string             `json:"previous_answer_error,omitempty"`
	Steps         []uitesting.Step   `json:"steps"`
	Captures      []GuideFrame       `json:"captures"`
}

// plannedTest is the part of a catalog test the coverage review needs.
type plannedTest struct {
	ID        string   `json:"id"`
	Title     string   `json:"title"`
	Goal      string   `json:"goal"`
	Category  string   `json:"category,omitempty"`
	Access    string   `json:"access,omitempty"`
	Steps     []string `json:"steps,omitempty"`
	DependsOn []string `json:"depends_on,omitempty"`
	Status    string   `json:"status,omitempty"`
}

func BuildGuideRequest(input GuideInput) (Request, error) {
	req, res, err := filenames("guide", input.TaskID, 0)
	if err != nil {
		return Request{}, err
	}
	if len(input.Screenshots) > maxGuideShots {
		input.Screenshots = input.Screenshots[len(input.Screenshots)-maxGuideShots:]
	}
	profile := input.ProfileLabel
	if profile == "" {
		profile = "acesso público, sem autenticação"
	}
	entries, names, total := []entry{}, []string{}, 0
	for _, shot := range input.Screenshots {
		total += len(shot.PNG)
		if !screenshotName.MatchString(shot.Name) || len(shot.PNG) == 0 || len(shot.PNG) > maxScreenshot || total > maxGuideBytes {
			return Request{}, fmt.Errorf("UI guide screenshot %q is invalid or exceeds its bound", shot.Name)
		}
		entries = append(entries, entry{"screenshots/" + shot.Name, shot.PNG})
		names = append(names, shot.Name)
	}
	frames, err := guideFrames(input.Screenshots, input.Steps)
	if err != nil {
		return Request{}, err
	}
	state, err := json.MarshalIndent(guideState{Test: input.Test, Prerequisites: input.Prerequisites, EnvironmentID: input.EnvironmentID,
		Environment: input.EnvironmentName, About: input.EnvironmentInfo, Profile: profile, Status: input.Status,
		PreviousError: truncateError(input.PreviousError), Steps: input.Steps, Captures: frames}, "", "  ")
	if err != nil {
		return Request{}, err
	}
	planned, err := json.MarshalIndent(plannedTests(input.Planned), "", "  ")
	if err != nil {
		return Request{}, err
	}
	m := Manifest{Protocol: GuideRequestProtocol, Task: GuideTask, TaskID: input.TaskID, RunID: input.RunID,
		InputSHA256: digest(state, planned), RequestFilename: req, ResultFilename: res, PromptPath: guidePromptPath}
	request, err := build(m, guidePrompt(m), append([]entry{{guideStatePath, state}, {guidePlannedPath, planned}}, entries...))
	request.Guide = &GuideBinding{Screenshots: names, Frames: frames, EnvironmentID: input.EnvironmentID,
		EnvironmentName: input.EnvironmentName, Profile: input.ProfileLabel, RunStatus: input.Status}
	return request, err
}

func plannedTests(tests []uitesting.TestCase) []plannedTest {
	out := []plannedTest{}
	for _, test := range tests {
		if len(out) == maxPlannedTests {
			break
		}
		item := plannedTest{ID: test.ID, Title: test.Title, Goal: test.Goal, Category: test.Category, Access: test.Access, DependsOn: test.DependsOn, Status: test.Status}
		for _, step := range test.Steps {
			item.Steps = append(item.Steps, clip(step.Action, 200))
		}
		out = append(out, item)
	}
	return out
}
