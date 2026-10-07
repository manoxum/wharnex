package guidedoc

import (
	"bytes"
	"embed"
	"fmt"
	"html/template"
	"strings"
)

//go:embed assets/*.css assets/guide.js assets/guide.html.tmpl
var assets embed.FS

var page = template.Must(template.New("guide.html.tmpl").Funcs(template.FuncMap{"inline": Inline, "pad": func(n int) string { return fmt.Sprintf("%02d", n) }}).
	ParseFS(assets, "assets/guide.html.tmpl"))

// ImageSource gives the URL of a capture: a relative name for a page printed
// beside its files, or a data URL for a self-contained page.
type ImageSource func(name string) template.URL

// HTML renders the guide page. Every GPT string is escaped by html/template;
// the only markup it may produce is the **label** emphasis of Inline.
func HTML(d Document, source ImageSource) (string, error) {
	css, err := stylesheet()
	if err != nil {
		return "", err
	}
	js, err := assets.ReadFile("assets/guide.js")
	if err != nil {
		return "", err
	}
	view := newView(d, source)
	view.CSS, view.JS = template.CSS(css), template.JS(js)
	var out bytes.Buffer
	if err := page.Execute(&out, view); err != nil {
		return "", fmt.Errorf("render UI guide: %w", err)
	}
	return out.String(), nil
}

// The stylesheet is kept in cascade order: tokens, page, steps, print.
func stylesheet() (string, error) {
	var b strings.Builder
	for _, name := range []string{"theme.css", "layout.css", "steps.css", "print.css"} {
		raw, err := assets.ReadFile("assets/" + name)
		if err != nil {
			return "", err
		}
		b.Write(raw)
		b.WriteString("\n")
	}
	return b.String(), nil
}

// Inline escapes value and turns **text** into an emphasised interface label.
func Inline(value string) template.HTML {
	parts := strings.Split(template.HTMLEscapeString(oneLine(value)), "**")
	var b strings.Builder
	for i, part := range parts {
		if i%2 == 1 && i < len(parts)-1 {
			b.WriteString(`<strong class="ui">` + part + `</strong>`)
			continue
		}
		if i%2 == 1 {
			b.WriteString("**")
		}
		b.WriteString(part)
	}
	return template.HTML(b.String())
}
