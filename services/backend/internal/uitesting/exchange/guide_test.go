package exchange

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"image"
	"image/png"
	"io"
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/uitesting"
	"kernl.local/harness/backend/internal/uitesting/guidedoc"
)

func pngBytes(t *testing.T) []byte {
	t.Helper()
	var buffer bytes.Buffer
	if err := png.Encode(&buffer, image.NewRGBA(image.Rect(0, 0, 1000, 600))); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func guideRequest(t *testing.T) Request {
	t.Helper()
	button := &guidedoc.Rect{X: 0.8, Y: 0.05, W: 0.1, H: 0.06}
	offscreen := &guidedoc.Rect{X: 0.1, Y: 1.4, W: 0.2, H: 0.1}
	shot := func(name string) Screenshot {
		return Screenshot{Name: name, Caption: "Ecrã", PNG: pngBytes(t), Elements: []PageElement{
			{Selector: "#menu", Tag: "a", Text: "Início", Rect: &guidedoc.Rect{X: 0.02, Y: 0.05, W: 0.1, H: 0.05}},
			{Selector: "#entrar", Tag: "button", Text: "Entrar", Rect: button}, {Selector: "#rodape", Tag: "a", Rect: offscreen}}}
	}
	request, err := BuildGuideRequest(GuideInput{TaskID: taskID, RunID: "run_x", Test: uitesting.TestCase{ID: "login", Title: "Login"},
		EnvironmentID: "portal", EnvironmentName: "Portal", Status: "passed",
		Steps:       []uitesting.Step{{Index: 1, Action: "click", Screenshot: "step-01.png", Selector: "#entrar"}},
		Screenshots: []Screenshot{shot("step-01.png"), shot("step-02.png"), shot("step-03.png")},
		Planned:     []uitesting.TestCase{{ID: "login", Title: "Login", Goal: "Entrar", EnvironmentID: "portal", Steps: []uitesting.StrategyStep{{Action: "Clicar em Entrar"}}}}})
	if err != nil {
		t.Fatal(err)
	}
	return request
}

// archiveText concatenates every entry of a request archive.
func archiveText(t *testing.T, archive []byte) string {
	t.Helper()
	reader, err := zip.NewReader(bytes.NewReader(archive), int64(len(archive)))
	if err != nil {
		t.Fatal(err)
	}
	var out strings.Builder
	for _, file := range reader.File {
		opened, _ := file.Open()
		raw, _ := io.ReadAll(opened)
		opened.Close()
		out.Write(raw)
	}
	return out.String()
}

func validAnswer(m Manifest) GuideAnswer {
	return GuideAnswer{Protocol: GuideResultProtocol, Task: GuideTask, TaskID: m.TaskID, RunID: m.RunID, InputSHA256: m.InputSHA256,
		Title: "Entrar no portal", Summary: "Aceder à área reservada.", Audience: "Utilizadores registados.", ExpectedResult: "O painel abre.",
		Theme: guidedoc.Theme{Accent: "teal", Cover: "aurora"},
		Sections: []AnswerSection{{Title: "Iniciar sessão", Steps: []AnswerStep{
			{Title: "Abra o login", Instructions: []string{"Clique em **Entrar**."}, Layout: "hero", Capture: "step-01.png", View: "focus", Caption: "Página inicial",
				Annotations: []AnswerMark{{Element: "e1", Label: "Botão **Entrar**"}}},
			{Title: "Confirme", Instructions: []string{"Veja o painel."}, Layout: "split", Capture: "step-03.png", View: "full", Caption: "Painel",
				Annotations: []AnswerMark{{Region: &guidedoc.Rect{X: 0.3, Y: 0.3, W: 0.2, H: 0.1}, Label: "Mensagem de boas-vindas"}}},
		}}},
		Captions: map[string]string{"step-01.png": "Início", "step-02.png": "Login", "step-03.png": "Painel"},
		Verdict:  GuideVerdict{Status: "passed", Reason: "Painel visível."}}
}

func guideBundle(t *testing.T, answer GuideAnswer) []byte {
	raw, _ := json.Marshal(answer)
	return answerZip(t, map[string][]byte{guideAnswerPath: raw})
}

func TestGuideRequestCarriesMeasuredElementsAndThePlan(t *testing.T) {
	request := guideRequest(t)
	frame := request.Guide.Frames[0]
	if frame.Capture.Width != 1000 || frame.Capture.Height != 600 || len(frame.Elements) != 2 {
		t.Fatalf("frame=%#v", frame)
	}
	if frame.Elements[0].ID != "e1" || !frame.Elements[0].ActedOn || frame.Elements[0].Text != "Entrar" {
		t.Fatalf("the acted-on element must come first: %#v", frame.Elements)
	}
	archive := archiveText(t, request.Archive)
	for _, want := range []string{guidePlannedPath, "Clicar em Entrar", "proposed_tests", "duplicadas ou redundantes", `"acted_on": true`} {
		if !strings.Contains(archive, want) {
			t.Fatalf("guide request lacks %q", want)
		}
	}
}

func TestGuideAnswerResolvesMarkersCropsAndProposals(t *testing.T) {
	request := guideRequest(t)
	m, binding := request.Manifest, *request.Guide
	answer := validAnswer(m)
	answer.ProposedTests = []uitesting.TestCase{{ID: "abrir-menu-inicio", Title: "Abrir Início", Goal: "Ver a página inicial", EnvironmentID: "portal", Access: "public"}}
	result, err := ParseGuideAnswer(m.ResultFilename, guideBundle(t, answer), m, binding)
	if err != nil {
		t.Fatal(err)
	}
	step := result.Document.Sections[0].Steps[0]
	if step.Annotations[0].Box != (guidedoc.Rect{X: 0.8, Y: 0.05, W: 0.1, H: 0.06}) || step.Region.IsFull() || !step.Region.Contains(0.85, 0.08) {
		t.Fatalf("marker or crop not resolved: %#v", step)
	}
	if !result.Document.Sections[0].Steps[1].Region.IsFull() || result.Document.Outcome != "passed" || len(result.ProposedTests) != 1 {
		t.Fatalf("document=%#v", result.Document)
	}
	if !strings.Contains(result.Markdown, "![Página inicial](step-01.png)") || strings.Contains(result.Markdown, "step-02.png") || result.Captions["step-02.png"] == "" {
		t.Fatalf("a redundant capture must be omittable but still captioned:\n%s", result.Markdown)
	}
}

func TestGuideAnswerRefusesInvalidCompositions(t *testing.T) {
	request := guideRequest(t)
	m, binding := request.Manifest, *request.Guide
	cases := map[string]func(*GuideAnswer){
		"capture repeated": func(a *GuideAnswer) { a.Sections[0].Steps[1].Capture = "step-01.png" },
		"capture out of order": func(a *GuideAnswer) {
			a.Sections[0].Steps[0].Capture, a.Sections[0].Steps[1].Capture = "step-03.png", "step-01.png"
		},
		"unknown element":     func(a *GuideAnswer) { a.Sections[0].Steps[0].Annotations[0].Element = "e9" },
		"unmarked capture":    func(a *GuideAnswer) { a.Sections[0].Steps[0].Annotations = nil },
		"layout outside set":  func(a *GuideAnswer) { a.Sections[0].Steps[0].Layout = "carousel" },
		"accent outside set":  func(a *GuideAnswer) { a.Theme.Accent = "neon" },
		"crop hides a marker": func(a *GuideAnswer) { a.Sections[0].Steps[0].Region = &guidedoc.Rect{X: 0, Y: 0.5, W: 0.5, H: 0.5} },
		"caption missing":     func(a *GuideAnswer) { delete(a.Captions, "step-02.png") },
		"other environment": func(a *GuideAnswer) {
			a.ProposedTests = []uitesting.TestCase{{ID: "x", Title: "X", Goal: "Y", EnvironmentID: "kiosk", Access: "public"}}
		},
	}
	for name, mutate := range cases {
		answer := validAnswer(m)
		mutate(&answer)
		if _, err := ParseGuideAnswer(m.ResultFilename, guideBundle(t, answer), m, binding); err == nil {
			t.Fatalf("%s accepted", name)
		}
	}
}

func TestGuideAnswerToAV1RequestStaysParseable(t *testing.T) {
	m := Manifest{Protocol: GuideRequestProtocolV1, Task: GuideTask, TaskID: taskID, RunID: "run_x", InputSHA256: "abc", ResultFilename: "whx_ui_test_guide_res_" + taskID + ".zip"}
	manifest, _ := json.Marshal(GuideAnswerV1{Protocol: GuideResultProtocolV1, Task: GuideTask, TaskID: taskID, RunID: "run_x", InputSHA256: "abc", Title: "Entrar",
		Captions: map[string]string{"step-01.png": "Login"}, Verdict: GuideVerdict{Status: "passed", Reason: "ok"}})
	bundle := answerZip(t, map[string][]byte{guideManifestV1: manifest, guideMarkdownV1: []byte("![x](step-01.png)")})
	result, err := ParseGuideAnswer(m.ResultFilename, bundle, m, GuideBinding{Screenshots: []string{"step-01.png"}})
	if err != nil || result.Document != nil || result.Title != "Entrar" {
		t.Fatalf("result=%#v err=%v", result, err)
	}
}
