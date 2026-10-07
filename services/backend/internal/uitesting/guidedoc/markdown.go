package guidedoc

import (
	"fmt"
	"strings"
)

// Markdown renders the guide with the fixed sections every guide of a manual
// shares, captures referenced as `![legenda](step-NN.png)` followed by the
// legend of their numbered markers.
func Markdown(d Document) string {
	var b strings.Builder
	if d.Subtitle != "" {
		b.WriteString("_" + oneLine(d.Subtitle) + "_\n\n")
	}
	section(&b, "Para que serve", d.Summary)
	section(&b, "Quem pode usar", d.Audience)
	b.WriteString("## Antes de começar\n\n")
	if len(d.BeforeYouStart) == 0 {
		b.WriteString("Não há pré-requisitos.\n\n")
	}
	for _, item := range d.BeforeYouStart {
		b.WriteString("- " + oneLine(item) + "\n")
	}
	if len(d.BeforeYouStart) > 0 {
		b.WriteString("\n")
	}
	b.WriteString("## Passo a passo\n\n")
	number := 0
	for _, sec := range d.Sections {
		if len(d.Sections) > 1 {
			b.WriteString("### " + oneLine(sec.Title) + "\n\n")
		}
		if sec.Intro != "" {
			b.WriteString(oneLine(sec.Intro) + "\n\n")
		}
		for _, step := range sec.Steps {
			number++
			markdownStep(&b, number, step)
		}
	}
	section(&b, "Resultado esperado", d.ExpectedResult)
	b.WriteString("## Erros comuns e soluções\n\n")
	if len(d.Troubleshooting) == 0 {
		b.WriteString("Não foram identificados erros comuns neste fluxo.\n\n")
	}
	for _, item := range d.Troubleshooting {
		b.WriteString("- **" + oneLine(item.Problem) + "** — " + oneLine(item.Solution) + "\n")
	}
	if len(d.Troubleshooting) > 0 {
		b.WriteString("\n")
	}
	b.WriteString("## Funcionalidades relacionadas\n\n")
	if len(d.Related) == 0 {
		b.WriteString("Sem funcionalidades relacionadas.\n")
	}
	for _, item := range d.Related {
		b.WriteString("- " + oneLine(item) + "\n")
	}
	return b.String()
}

func markdownStep(b *strings.Builder, number int, step Step) {
	fmt.Fprintf(b, "**Passo %d — %s**\n\n", number, oneLine(step.Title))
	for i, line := range step.Instructions {
		fmt.Fprintf(b, "%d. %s\n", i+1, oneLine(line))
	}
	b.WriteString("\n")
	if step.Capture != nil {
		b.WriteString("![" + strings.NewReplacer("[", "(", "]", ")").Replace(oneLine(step.Caption)) + "](" + step.Capture.Name + ")\n\n")
		for _, mark := range step.Annotations {
			fmt.Fprintf(b, "- **%d** %s\n", mark.Number, oneLine(mark.Label))
		}
		if len(step.Annotations) > 0 {
			b.WriteString("\n")
		}
	}
	if step.Callout != nil {
		b.WriteString("> **" + calloutTitle(step.Callout.Kind) + ":** " + oneLine(step.Callout.Text) + "\n\n")
	}
}

func section(b *strings.Builder, title, body string) {
	b.WriteString("## " + title + "\n\n" + strings.TrimSpace(body) + "\n\n")
}

func oneLine(value string) string { return strings.Join(strings.Fields(value), " ") }

func calloutTitle(kind string) string {
	switch kind {
	case "warning":
		return "Atenção"
	case "success":
		return "Confirmação"
	case "note":
		return "Nota"
	default:
		return "Dica"
	}
}
