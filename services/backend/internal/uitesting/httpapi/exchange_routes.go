package httpapi

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"

	"kernl.local/harness/backend/internal/session"
	"kernl.local/harness/backend/internal/uitesting"
	"kernl.local/harness/backend/internal/uitesting/exchange"
)

type stepRequestInput struct {
	RunID            string                 `json:"run_id"`
	Sequence         int                    `json:"sequence"`
	Iteration        int                    `json:"iteration"`
	CurrentURL       string                 `json:"current_url"`
	RestoredFrom     string                 `json:"restored_from"`
	PreviousError    string                 `json:"previous_error"`
	Elements         []exchange.PageElement `json:"elements"`
	History          []uitesting.Step       `json:"history"`
	ScreenshotBase64 string                 `json:"screenshot_base64"`
}

type guideRequestInput struct {
	RunID         string           `json:"run_id"`
	Status        string           `json:"status"`
	PreviousError string           `json:"previous_error"`
	Steps         []uitesting.Step `json:"steps"`
	Screenshots   []struct {
		Name          string `json:"name"`
		Caption       string `json:"caption"`
		ContentBase64 string `json:"content_base64"`
	} `json:"screenshots"`
}

type exchangeAnswerInput struct {
	Sequence     int    `json:"sequence"`
	Filename     string `json:"filename"`
	BundleBase64 string `json:"bundle_base64"`
}

// stepRequest builds the request bundle for one controller iteration.
func (h *Routes) stepRequest(w http.ResponseWriter, r *http.Request) {
	task, payload, ok := h.loadRunTask(w, r)
	var input stepRequestInput
	if !ok || !decodeBody(w, r, 8<<20, &input) {
		return
	}
	item, index, found := payload.chainRun(input.RunID)
	origin, err := environmentOrigin(payload.Environment.URL)
	current, urlErr := url.Parse(input.CurrentURL)
	screenshot, shotErr := base64.StdEncoding.DecodeString(input.ScreenshotBase64)
	restoreAllowed := input.RestoredFrom == "" || (payload.Restore != nil && input.RestoredFrom == payload.Restore.TestID)
	if !found || err != nil || urlErr != nil || current.Scheme+"://"+current.Host != origin || shotErr != nil || !restoreAllowed {
		writeErr(w, 403, errors.New("UI test step does not match this run"))
		return
	}
	total := max(1, len(payload.FullChain))
	request, err := exchange.BuildStepRequest(exchange.StepInput{TaskID: task.TaskID, RunID: input.RunID, Sequence: input.Sequence,
		Test: item.Test, Role: item.Role, Position: index + 1, Total: total, EnvironmentName: payload.Environment.Name,
		EnvironmentNotes: h.environmentNotes(task.ProjectID, payload.Environment.ID), Origin: origin,
		ProfileLabel: payload.Profile.Label, ProfileRole: payload.Profile.Role, CurrentURL: current.String(), Iteration: input.Iteration,
		MaxStep: payload.MaxSteps, RestoredFrom: input.RestoredFrom, PreviousError: input.PreviousError, Elements: input.Elements, History: input.History, Screenshot: screenshot})
	if err != nil {
		writeErr(w, 400, err)
		return
	}
	h.pending.put(request.Manifest, exchange.ActionRules{Origin: origin, CurrentURL: current.String(), AllowSessionInvalid: input.RestoredFrom != "", CredentialsAvailable: payload.Profile.ID != ""})
	writeExchangeRequest(w, request)
}

func (h *Routes) stepAnswer(w http.ResponseWriter, r *http.Request) {
	task, _, ok := h.loadRunTask(w, r)
	var input exchangeAnswerInput
	if !ok || !decodeBody(w, r, 8<<20, &input) {
		return
	}
	pending, found := h.pending.take(pendingKey(task.TaskID, "step", input.Sequence))
	bundle, err := base64.StdEncoding.DecodeString(strings.TrimSpace(input.BundleBase64))
	if !found || err != nil {
		writeErr(w, 409, errors.New("UI test step answer has no matching request"))
		return
	}
	decision, err := exchange.ParseStepAnswer(strings.TrimSpace(input.Filename), bundle, pending.Manifest, pending.Rules)
	if err != nil {
		writeErr(w, 400, err)
		return
	}
	writeJSON(w, 200, decision)
}

// guideRequest builds the user-guide request for the selected test's run.
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
	guide := exchange.GuideInput{TaskID: task.TaskID, RunID: input.RunID, Test: item.Test, EnvironmentName: payload.Environment.Name,
		EnvironmentInfo: h.environmentDescription(task.ProjectID, payload.Environment.ID), ProfileLabel: payload.Profile.Label, Status: input.Status, PreviousError: input.PreviousError, Steps: input.Steps}
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
		guide.Screenshots = append(guide.Screenshots, exchange.Screenshot{Name: shot.Name, Caption: shot.Caption, PNG: png})
	}
	request, err := exchange.BuildGuideRequest(guide)
	if err != nil {
		writeErr(w, 400, err)
		return
	}
	h.pending.put(request.Manifest, exchange.ActionRules{}, request.Screenshots...)
	writeExchangeRequest(w, request)
}

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
	result, err := exchange.ParseGuideAnswer(strings.TrimSpace(input.Filename), bundle, pending.Manifest, pending.Screenshots)
	if err != nil {
		writeErr(w, 400, err)
		return
	}
	writeJSON(w, 200, result)
}

func writeExchangeRequest(w http.ResponseWriter, request exchange.Request) {
	writeJSON(w, 200, map[string]any{"request": request.Manifest, "bootstrap": request.Bootstrap, "archive_base64": base64.StdEncoding.EncodeToString(request.Archive)})
}

func (h *Routes) loadRunTask(w http.ResponseWriter, r *http.Request) (session.ChatAgentTask, runPayload, bool) {
	var payload runPayload
	task, err := h.sessions.GetChatAgentTask(r.PathValue("id"))
	if err != nil || task.Type != "UI_TEST_RUN" || json.Unmarshal(task.Payload, &payload) != nil {
		writeErr(w, 404, errors.New("UI test task not found"))
		return task, payload, false
	}
	return task, payload, true
}

func decodeBody(w http.ResponseWriter, r *http.Request, limit int64, target any) bool {
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, limit)).Decode(target); err != nil {
		writeErr(w, 400, errors.New("invalid UI test exchange request"))
		return false
	}
	return true
}

func (h *Routes) environmentDescription(project, environmentID string) string {
	return h.environment(project, environmentID).Description
}

func (h *Routes) environmentNotes(project, environmentID string) string {
	return h.environment(project, environmentID).Notes
}

func (h *Routes) environment(project, environmentID string) uitesting.Environment {
	doc, err := h.store.Load(project)
	if err == nil {
		for _, env := range doc.Environments {
			if env.ID == environmentID {
				return env
			}
		}
	}
	return uitesting.Environment{}
}
