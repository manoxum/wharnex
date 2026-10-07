package httpapi

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/uitesting/exchange"
)

func zipWith(t *testing.T, name string, data []byte) string {
	t.Helper()
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	part, _ := writer.Create(name)
	_, _ = part.Write(data)
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return base64.StdEncoding.EncodeToString(buffer.Bytes())
}

func TestStepExchangeRoundTripsThroughValidatedBundles(t *testing.T) {
	routes, mux, _ := chainFixture(t)
	payload := runOnly(t, routes, mux, "login")
	taskPath := "/api/ui-testing/tasks/cat_" + strings.TrimPrefix(payload.RunID, "run_")
	shot := base64.StdEncoding.EncodeToString([]byte("png"))

	foreign := call(t, mux, http.MethodPost, taskPath+"/step", stepRequestInput{RunID: payload.RunID, Sequence: 1, CurrentURL: "https://evil.test/", ScreenshotBase64: shot})
	if foreign.Code != http.StatusForbidden {
		t.Fatalf("a page outside the environment origin was accepted: %d", foreign.Code)
	}
	response := call(t, mux, http.MethodPost, taskPath+"/step", stepRequestInput{RunID: payload.RunID, Sequence: 1, Iteration: 1, CurrentURL: "https://app.test/login", ScreenshotBase64: shot})
	if response.Code != 200 {
		t.Fatalf("step status=%d body=%s", response.Code, response.Body.String())
	}
	var issued struct {
		Request       exchange.Manifest `json:"request"`
		Bootstrap     string            `json:"bootstrap"`
		ArchiveBase64 string            `json:"archive_base64"`
	}
	if err := json.NewDecoder(response.Body).Decode(&issued); err != nil || issued.ArchiveBase64 == "" || !strings.Contains(issued.Bootstrap, issued.Request.ResultFilename) {
		t.Fatalf("issued=%#v err=%v", issued, err)
	}
	answer, _ := json.Marshal(exchange.StepAnswer{Protocol: exchange.StepResultProtocol, Task: exchange.StepTask, TaskID: issued.Request.TaskID, RunID: issued.Request.RunID,
		Sequence: 1, InputSHA256: issued.Request.InputSHA256, ScreenCaption: "Página de login do portal.", Action: &exchange.Action{Action: "fill_credential", Selector: "#username", Field: "username"}})
	result := call(t, mux, http.MethodPost, taskPath+"/step/result", exchangeAnswerInput{Sequence: 1, Filename: issued.Request.ResultFilename, BundleBase64: zipWith(t, "action.json", answer)})
	if result.Code != 200 || !strings.Contains(result.Body.String(), `"field":"username"`) || !strings.Contains(result.Body.String(), `"screen_caption":"Página de login do portal."`) {
		t.Fatalf("answer status=%d body=%s", result.Code, result.Body.String())
	}
	replay := call(t, mux, http.MethodPost, taskPath+"/step/result", exchangeAnswerInput{Sequence: 1, Filename: issued.Request.ResultFilename, BundleBase64: zipWith(t, "action.json", answer)})
	if replay.Code != http.StatusConflict {
		t.Fatalf("an answer was accepted twice: %d", replay.Code)
	}
}

func TestGuideExchangeIsReservedToTheSelectedTest(t *testing.T) {
	routes, mux, _ := chainFixture(t)
	payload := runOnly(t, routes, mux, "create-item")
	taskPath := "/api/ui-testing/tasks/cat_" + strings.TrimPrefix(payload.RunID, "run_")
	if response := call(t, mux, http.MethodPost, taskPath+"/guide", guideRequestInput{RunID: payload.Chain[0].RunID, Status: "passed"}); response.Code != http.StatusForbidden {
		t.Fatalf("a prerequisite run requested a guide: %d", response.Code)
	}
	response := call(t, mux, http.MethodPost, taskPath+"/guide", guideRequestInput{RunID: payload.RunID, Status: "passed"})
	if response.Code != 200 || !strings.Contains(response.Body.String(), "whx_ui_test_guide_res_") {
		t.Fatalf("guide status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestIssuedExchangesSurviveABackendRestart(t *testing.T) {
	dir := t.TempDir()
	before := newPendingExchanges(dir)
	before.put(exchange.Manifest{Task: exchange.StepTask, TaskID: "cat_x", Sequence: 4}, exchange.ActionRules{Origin: "https://app.test"}, nil)
	after := newPendingExchanges(dir)
	item, ok := after.take(pendingKey("cat_x", "step", 4))
	if !ok || item.Rules.Origin != "https://app.test" {
		t.Fatalf("issued exchange lost across restart: %#v", item)
	}
	if _, again := newPendingExchanges(dir).take(pendingKey("cat_x", "step", 4)); again {
		t.Fatal("an issued exchange was consumable twice")
	}
}
