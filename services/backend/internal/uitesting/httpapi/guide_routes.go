package httpapi

import (
	"encoding/base64"
	"errors"
	"html/template"
	"net/http"
	"strings"

	"kernl.local/harness/backend/internal/uitesting"
	"kernl.local/harness/backend/internal/uitesting/exchange"
	"kernl.local/harness/backend/internal/uitesting/guidedoc"
)

type guideRequestInput struct {
	RunID         string           `json:"run_id"`
	Status        string           `json:"status"`
	PreviousError string           `json:"previous_error"`
	Steps         []uitesting.Step `json:"steps"`
	Screenshots   []struct {
		Name          string                 `json:"name"`
		Caption       string                 `json:"caption"`
		ContentBase64 string                 `json:"content_base64"`
		Elements      []exchange.PageElement `json:"elements"`
	} `json:"screenshots"`
}

// guideAnswerOutput is the validated guide plus what the Desktop needs to
// print it, and the outcome of merging the proposed coverage tests.
type guideAnswerOutput struct {
	exchange.GuideResult
	PrintHTML string         `json:"print_html,omitempty"`
	Coverage  coverageReport `json:"coverage"`
}

type coverageReport struct {
	Added []string `json:"added"`
	Error string   `json:"error,omitempty"`
}

// guideRequest builds the user-guide request for the selected test's run. It
// carries the environment's current test plan for the coverage review.
func (h *Routes) guideRequest(w http.ResponseWriter, r *http.Request) {
	task, payload, ok := h.loadRunTask(w, r)
	var input guideRequestInput
	if !ok || !decodeBody(w, r, 96<<20, &input) {
		return
	}
	item, _, found := payload.chainRun(input.RunID)
	if !found || item.Role != uitesting.RunRoleTarget {
		writeErr(w, 403, errors.New("only the selected test's run may request a user guide"))
		return
	}
	guide := exchange.GuideInput{TaskID: task.TaskID, RunID: input.RunID, Test: item.Test, EnvironmentID: payload.Environment.ID, EnvironmentName: payload.Environment.Name,
		EnvironmentInfo: h.environmentDescription(task.ProjectID, payload.Environment.ID), ProfileLabel: payload.Profile.Label, Status: input.Status,
		PreviousError: input.PreviousError, Steps: input.Steps, Planned: h.plannedTests(task.ProjectID, payload.Environment.ID)}
	for _, prerequisite := range payload.FullChain {
		if prerequisite.Role == uitesting.RunRoleDependency {
			guide.Prerequisites = append(guide.Prerequisites, prerequisite.Test.Title)
		}
	}
	for _, shot := range input.Screenshots {
		png, err := base64.StdEncoding.DecodeString(shot.ContentBase64)
		if err != nil {
			writeErr(w, 400, errors.New("UI guide screenshot is not valid base64"))
			return
		}
		guide.Screenshots = append(guide.Screenshots, exchange.Screenshot{Name: shot.Name, Caption: shot.Caption, PNG: png, Elements: shot.Elements})
	}
	request, err := exchange.BuildGuideRequest(guide)
	if err != nil {
		writeErr(w, 400, err)
		return
	}
	h.pending.put(request.Manifest, exchange.ActionRules{}, request.Guide)
	writeExchangeRequest(w, request)
}

// guideAnswer validates the guide, renders the page the Desktop prints to PDF
// and adds the proposed coverage tests to the catalog. A coverage merge the
// catalog refuses is reported and never costs the guide.
func (h *Routes) guideAnswer(w http.ResponseWriter, r *http.Request) {
	task, _, ok := h.loadRunTask(w, r)
	var input exchangeAnswerInput
	if !ok || !decodeBody(w, r, 8<<20, &input) {
		return
	}
	pending, found := h.pending.take(pendingKey(task.TaskID, "guide", 0))
	bundle, err := base64.StdEncoding.DecodeString(strings.TrimSpace(input.BundleBase64))
	if !found || err != nil {
		writeErr(w, 409, errors.New("UI guide answer has no matching request"))
		return
	}
	result, err := exchange.ParseGuideAnswer(strings.TrimSpace(input.Filename), bundle, pending.Manifest, pending.guideBinding())
	if err != nil {
		writeErr(w, 400, err)
		return
	}
	output := guideAnswerOutput{GuideResult: result, Coverage: coverageReport{Added: []string{}}}
	if result.Document != nil {
		if output.PrintHTML, err = guidedoc.HTML(*result.Document, func(name string) template.URL { return template.URL(name) }); err != nil {
			writeErr(w, 500, err)
			return
		}
	}
	if len(result.ProposedTests) > 0 {
		added, _, err := h.store.SaveCoverage(task.ProjectID, result.ProposedTests)
		output.Coverage.Added = append(output.Coverage.Added, added...)
		if err != nil {
			output.Coverage.Error = err.Error()
		}
	}
	writeJSON(w, 200, output)
}

func (h *Routes) plannedTests(project, environmentID string) []uitesting.TestCase {
	doc, err := h.store.Load(project)
	if err != nil {
		return nil
	}
	tests := []uitesting.TestCase{}
	for _, test := range doc.Tests {
		if test.EnvironmentID == environmentID {
			tests = append(tests, test)
		}
	}
	return tests
}
