package exchange

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"io"
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/uitesting"
)

const taskID = "cat_1234567890abcdef1234"

func answerZip(t *testing.T, files map[string][]byte) []byte {
	t.Helper()
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	for name, data := range files {
		part, _ := writer.Create(name)
		_, _ = part.Write(data)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func stepRequest(t *testing.T) Request {
	t.Helper()
	request, err := BuildStepRequest(StepInput{TaskID: taskID, RunID: "run_x", Sequence: 3, Origin: "https://app.test",
		Test: uitesting.TestCase{ID: "login", Title: "Login", Goal: "Entrar"}, CurrentURL: "https://app.test/login",
		ProfileLabel: "Admin", ProfileRole: "admin", Screenshot: []byte("png"), Position: 1, Total: 1, Iteration: 2, MaxStep: 24})
	if err != nil {
		t.Fatal(err)
	}
	return request
}

func stepAnswer(t *testing.T, m Manifest, action Action, mutate func(*StepAnswer)) []byte {
	answer := StepAnswer{Protocol: StepResultProtocol, Task: StepTask, TaskID: m.TaskID, RunID: m.RunID, Sequence: m.Sequence, InputSHA256: m.InputSHA256, ScreenCaption: "Ecrã de início de sessão com os campos vazios.", Action: &action}
	if mutate != nil {
		mutate(&answer)
	}
	raw, _ := json.Marshal(answer)
	return answerZip(t, map[string][]byte{stepResultPath: raw})
}

func TestStepRequestCarriesStateScreenshotAndInstructionsButNoPageInComposer(t *testing.T) {
	request := stepRequest(t)
	if request.Manifest.RequestFilename != "whx_ui_test_step_req_"+taskID+"_3.zip" || request.Manifest.ResultFilename != "whx_ui_test_step_res_"+taskID+"_3.zip" {
		t.Fatalf("manifest=%#v", request.Manifest)
	}
	reader, _ := zip.NewReader(bytes.NewReader(request.Archive), int64(len(request.Archive)))
	names := map[string]string{}
	for _, file := range reader.File {
		opened, _ := file.Open()
		raw, _ := io.ReadAll(opened)
		names[file.Name] = string(raw)
	}
	for _, name := range []string{TransportPath, stepPromptPath, stepStatePath, stepScreenshotPath} {
		if _, ok := names[name]; !ok {
			t.Fatalf("request lacks %s", name)
		}
	}
	if !strings.Contains(names[stepPromptPath], request.Manifest.ResultFilename) || strings.Contains(request.Bootstrap, "Entrar") {
		t.Fatal("instructions must live in the archive, not the composer")
	}
}

func TestStepAnswerIsBoundAndTheActionProtocolIsClosed(t *testing.T) {
	request := stepRequest(t)
	m := request.Manifest
	rules := ActionRules{Origin: "https://app.test", CurrentURL: "https://app.test/login", CredentialsAvailable: true}
	decision, err := ParseStepAnswer(m.ResultFilename, stepAnswer(t, m, Action{Action: "navigate", URL: "/dashboard", Caption: "abrir"}, nil), m, rules)
	if err != nil || decision.Actions[0].URL != "https://app.test/dashboard" || decision.ScreenCaption == "" {
		t.Fatalf("decision=%#v err=%v", decision, err)
	}
	if got, _ := ParseStepAnswer(m.ResultFilename, stepAnswer(t, m, Action{Action: "wait", Ms: 99999}, nil), m, rules); got.Actions[0].Ms != 5000 {
		t.Fatalf("wait not clamped: %d", got.Actions[0].Ms)
	}
	rejected := map[string][]byte{
		"foreign origin":  stepAnswer(t, m, Action{Action: "navigate", URL: "https://evil.test/"}, nil),
		"script":          stepAnswer(t, m, Action{Action: "javascript", Value: "alert(1)"}, nil),
		"key":             stepAnswer(t, m, Action{Action: "press", Selector: "#q", Key: "F12"}, nil),
		"no selector":     stepAnswer(t, m, Action{Action: "click"}, nil),
		"session invalid": stepAnswer(t, m, Action{Action: "finish", Status: "session_invalid"}, nil),
		"sequence":        stepAnswer(t, m, Action{Action: "click", Selector: "#a"}, func(a *StepAnswer) { a.Sequence = 4 }),
		"input digest":    stepAnswer(t, m, Action{Action: "click", Selector: "#a"}, func(a *StepAnswer) { a.InputSHA256 = "x" }),
		"no caption":      stepAnswer(t, m, Action{Action: "click", Selector: "#a"}, func(a *StepAnswer) { a.ScreenCaption = "  " }),
		"extra entry":     answerZip(t, map[string][]byte{stepResultPath: []byte("{}"), "notes.md": []byte("x")}),
	}
	for name, bundle := range rejected {
		if _, err := ParseStepAnswer(m.ResultFilename, bundle, m, rules); err == nil {
			t.Fatalf("%s: invalid answer accepted", name)
		}
	}
	if _, err := ParseStepAnswer("other.zip", stepAnswer(t, m, Action{Action: "click", Selector: "#a"}, nil), m, rules); err == nil {
		t.Fatal("foreign filename accepted")
	}
	public := ActionRules{Origin: rules.Origin, CurrentURL: rules.CurrentURL}
	if _, err := ParseStepAnswer(m.ResultFilename, stepAnswer(t, m, Action{Action: "fill_credential", Selector: "#u", Field: "username"}, nil), m, public); err == nil || !strings.Contains(err.Error(), "test_data") {
		t.Fatalf("a test without credentials accepted fill_credential: %v", err)
	}
	restored := ActionRules{Origin: rules.Origin, CurrentURL: rules.CurrentURL, AllowSessionInvalid: true}
	if got, err := ParseStepAnswer(m.ResultFilename, stepAnswer(t, m, Action{Action: "finish", Status: "session_invalid"}, nil), m, restored); err != nil || got.Actions[0].Status != "session_invalid" {
		t.Fatalf("restored run must allow session_invalid: %#v %v", got, err)
	}
}

func TestActionAcceptsTheUnambiguousNestedForm(t *testing.T) {
	var nested Action
	if err := json.Unmarshal([]byte(`{"navigate":{"url":"/login"},"caption":"abrir"}`), &nested); err != nil || nested.Action != "navigate" || nested.URL != "/login" || nested.Caption != "abrir" {
		t.Fatalf("nested=%#v err=%v", nested, err)
	}
	var finish Action
	if err := json.Unmarshal([]byte(`{"finish":{"status":"passed","caption":"ok"}}`), &finish); err != nil || finish.Status != "passed" {
		t.Fatalf("finish=%#v err=%v", finish, err)
	}
	for _, bad := range []string{`{"navigate":{"url":"/"},"click":{"selector":"a"}}`, `{"script":"x"}`, `{"action":"click","selector":"a","script":"x"}`, `{"click":{"selector":"a","script":"x"}}`, `{"click":"a"}`} {
		var action Action
		if err := json.Unmarshal([]byte(bad), &action); err == nil {
			t.Fatalf("%s accepted", bad)
		}
	}
}

func TestStepAnswerMayPlanASequence(t *testing.T) {
	request := stepRequest(t)
	m := request.Manifest
	rules := ActionRules{Origin: "https://app.test", CurrentURL: "https://app.test/login", CredentialsAvailable: true}
	plan := func(actions []Action, mutate func(*StepAnswer)) []byte {
		answer := StepAnswer{Protocol: StepResultProtocol, Task: StepTask, TaskID: m.TaskID, RunID: m.RunID, Sequence: m.Sequence, InputSHA256: m.InputSHA256, ScreenCaption: "Login.", Actions: actions}
		if mutate != nil {
			mutate(&answer)
		}
		raw, _ := json.Marshal(answer)
		return answerZip(t, map[string][]byte{stepResultPath: raw})
	}
	decision, err := ParseStepAnswer(m.ResultFilename, plan([]Action{{Action: "fill_credential", Selector: "#u", Field: "username"}, {Action: "click", Selector: "#go"}, {Action: "assert_text", Selector: "main", Text: "Painel"}, {Action: "finish", Status: "passed"}}, nil), m, rules)
	if err != nil || len(decision.Actions) != 4 {
		t.Fatalf("decision=%#v err=%v", decision, err)
	}
	bad := map[string][]byte{
		"finish not last": plan([]Action{{Action: "finish", Status: "passed"}, {Action: "click", Selector: "#a"}}, nil),
		"empty plan":      plan(nil, nil),
		"both shapes":     plan([]Action{{Action: "click", Selector: "#a"}}, func(a *StepAnswer) { a.Action = &Action{Action: "click", Selector: "#b"} }),
		"too long":        plan(make([]Action, MaxPlannedActions+1), nil),
		"bad member":      plan([]Action{{Action: "click", Selector: "#a"}, {Action: "navigate", URL: "https://evil.test"}}, nil),
	}
	for name, bundle := range bad {
		if _, err := ParseStepAnswer(m.ResultFilename, bundle, m, rules); err == nil {
			t.Fatalf("%s accepted", name)
		}
	}
}
