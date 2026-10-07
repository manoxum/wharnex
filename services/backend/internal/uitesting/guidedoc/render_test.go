package guidedoc

import (
	"html/template"
	"strings"
	"testing"
)

func sample() Document {
	capture := &Capture{Name: "step-01.png", Width: 1024, Height: 680}
	return Document{Version: Version, Title: "Entrar <no> portal", Summary: "Aceder à área **reservada**.", Audience: "Utilizadores registados.",
		Environment: "Portal", Outcome: "passed", Theme: Theme{Accent: "violet", Cover: "mesh"}, ExpectedResult: "O painel abre.",
		Sections: []Section{{Title: "Iniciar sessão", Steps: []Step{
			{Title: "Abra o login", Instructions: []string{"Clique em **Entrar**."}, Layout: "split", Capture: capture,
				Region: Rect{X: 0.5, Y: 0, W: 0.5, H: 0.5}, Caption: "Página inicial", Annotations: []Annotation{{Number: 1, Label: "Botão **Entrar**", Box: Rect{X: 0.8, Y: 0.1, W: 0.1, H: 0.05}}},
				Callout: &Callout{Kind: "tip", Text: "Use o seu utilizador."}},
			{Title: "Confirme", Instructions: []string{"Veja o painel."}, Layout: "compact"},
		}}},
		Troubleshooting: []Trouble{{Problem: "Senha errada", Solution: "Tente de novo."}}}
}

func TestHTMLEscapesTextAndPlacesMarkersInsideTheCrop(t *testing.T) {
	page, err := HTML(sample(), func(name string) template.URL { return template.URL(name) })
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{`data-accent="violet"`, "cover-mesh", "Entrar &lt;no&gt; portal", `<strong class="ui">Entrar</strong>`,
		`src="step-01.png"`, "width:200.000%;left:-100.000%;top:-0.000%", "left:60.000%;top:20.000%;width:20.000%;height:10.000%",
		`data-marks="1,0.8000,0.1000,0.1000,0.0500"`, "callout-tip", "step-compact", "Verificado numa execução real"} {
		if !strings.Contains(page, want) {
			t.Fatalf("rendered guide lacks %q", want)
		}
	}
	if strings.Contains(page, "<no>") || strings.Contains(page, "ZgotmplZ") {
		t.Fatal("guide text was not escaped safely")
	}
}

func TestMarkdownKeepsTheManualSectionsAndLegends(t *testing.T) {
	md := Markdown(sample())
	for _, want := range []string{"## Para que serve", "## Quem pode usar", "## Antes de começar", "## Passo a passo", "**Passo 1 — Abra o login**",
		"![Página inicial](step-01.png)", "- **1** Botão **Entrar**", "## Resultado esperado", "## Erros comuns e soluções", "## Funcionalidades relacionadas"} {
		if !strings.Contains(md, want) {
			t.Fatalf("markdown lacks %q:\n%s", want, md)
		}
	}
}

func TestFocusCropsAroundBoxesWithAReadableShape(t *testing.T) {
	region := FocusOn([]Rect{{X: 0.8, Y: 0.1, W: 0.1, H: 0.05}}, 1024, 680)
	if region.IsFull() || !region.Valid() || region.W < minRegionW || region.H < minRegionH {
		t.Fatalf("unexpected focus region %+v", region)
	}
	if !region.Contains(0.85, 0.125) {
		t.Fatalf("focus region %+v does not contain its box", region)
	}
	if !FocusOn([]Rect{{X: 0, Y: 0, W: 1, H: 1}}, 1024, 680).IsFull() {
		t.Fatal("a box covering the screen must not be cropped")
	}
}
