package httpapi

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/png"
	"net/http"
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/uitesting"
	"kernl.local/harness/backend/internal/uitesting/exchange"
	"kernl.local/harness/backend/internal/uitesting/guidedoc"
)

func TestGuideRoundTripPrintsAddsCoverageAndServesTheHTMLGuide(t *testing.T) {
	routes, mux, project := chainFixture(t)
	payload := runOnly(t, routes, mux, "login")
	taskPath := "/api/ui-testing/tasks/cat_" + strings.TrimPrefix(payload.RunID, "run_")
	var buffer bytes.Buffer
	_ = png.Encode(&buffer, image.NewRGBA(image.Rect(0, 0, 800, 500)))
	shot := base64.StdEncoding.EncodeToString(buffer.Bytes())
	input := guideRequestInput{RunID: payload.RunID, Status: "passed", Steps: []uitesting.Step{{Index: 1, Action: "click", Screenshot: "step-01.png", Selector: "#go"}}}
	input.Screenshots = append(input.Screenshots, struct {
		Name          string                 `json:"name"`
		Caption       string                 `json:"caption"`
		ContentBase64 string                 `json:"content_base64"`
		Elements      []exchange.PageElement `json:"elements"`
	}{Name: "step-01.png", ContentBase64: shot, Elements: []exchange.PageElement{{Selector: "#go", Tag: "button", Text: "Entrar", Rect: &guidedoc.Rect{X: 0.4, Y: 0.4, W: 0.2, H: 0.08}}}})
	response := call(t, mux, http.MethodPost, taskPath+"/guide", input)
	var issued struct {
		Request exchange.Manifest `json:"request"`
	}
	if response.Code != 200 || json.NewDecoder(response.Body).Decode(&issued) != nil {
		t.Fatalf("guide request status=%d", response.Code)
	}
	m := issued.Request
	answer, _ := json.Marshal(exchange.GuideAnswer{Protocol: exchange.GuideResultProtocol, Task: exchange.GuideTask, TaskID: m.TaskID, RunID: m.RunID, InputSHA256: m.InputSHA256,
		Title: "Entrar", Summary: "Aceder.", Audience: "Admin.", ExpectedResult: "Painel.", Theme: guidedoc.Theme{Accent: "rose", Cover: "split"},
		Sections: []exchange.AnswerSection{{Title: "Sessão", Steps: []exchange.AnswerStep{{Title: "Entre", Instructions: []string{"Clique em **Entrar**."}, Layout: "focus",
			Capture: "step-01.png", View: "focus", Caption: "Login", Annotations: []exchange.AnswerMark{{Element: "e1", Label: "Entrar"}}}}}},
		Captions:      map[string]string{"step-01.png": "Login"},
		ProposedTests: []uitesting.TestCase{{ID: "recuperar-senha", Title: "Recuperar senha", Goal: "Pedir nova senha", EnvironmentID: "web", Access: uitesting.AccessPublic}},
		Verdict:       exchange.GuideVerdict{Status: "passed", Reason: "Painel visível."}})
	result := call(t, mux, http.MethodPost, taskPath+"/guide/result", exchangeAnswerInput{Filename: m.ResultFilename, BundleBase64: zipWith(t, "guide.json", answer)})
	var output guideAnswerOutput
	if result.Code != 200 || json.NewDecoder(result.Body).Decode(&output) != nil {
		t.Fatalf("guide answer status=%d body=%s", result.Code, result.Body.String())
	}
	if !strings.Contains(output.PrintHTML, `src="step-01.png"`) || len(output.Coverage.Added) != 1 || output.Document == nil {
		t.Fatalf("output=%+v", output.Coverage)
	}

	run := uitesting.Run{ID: payload.RunID, TestID: "login"}
	if _, err := routes.store.CompleteRun(project, run, uitesting.RunResult{Status: "passed", GuideTitle: "Entrar", GuideMD: output.Markdown, GuideDocument: output.Document,
		Screenshots: []uitesting.Screenshot{{Name: "step-01.png", ContentBase64: shot}}}); err != nil {
		t.Fatal(err)
	}
	page := call(t, mux, http.MethodGet, "/api/sessions/ses_chain/ui-testing/assets/"+payload.RunID+"/guide.html", nil)
	if page.Code != 200 || page.Header().Get("Content-Security-Policy") != guidePageCSP || !strings.Contains(page.Body.String(), `src="data:image/png;base64,`) {
		t.Fatalf("guide page status=%d csp=%q", page.Code, page.Header().Get("Content-Security-Policy"))
	}
	doc, _ := routes.store.Load(project)
	if len(doc.Guides) != 1 || !doc.Guides[0].HTMLReady {
		t.Fatalf("guides=%#v", doc.Guides)
	}
}
