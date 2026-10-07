package httpapi

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"html/template"
	"net/http"
	"os"
	"path/filepath"

	"kernl.local/harness/backend/internal/uitesting"
	"kernl.local/harness/backend/internal/uitesting/guidedoc"
)

const guidePageAsset = "guide.html"

// guidePageCSP lets the page run only its own inline script and style and
// load only the captures embedded in it: it can reach nothing else, whether
// it is framed by the app or opened in a browser.
const guidePageCSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"

// guidePage renders a stored structured guide as one self-contained HTML
// page, so the current design applies to every guide whenever it is opened.
func (h *Routes) guidePage(w http.ResponseWriter, project, runID string) {
	source, err := h.store.AssetPath(project, runID, uitesting.GuideDocumentAsset)
	if err != nil {
		writeErr(w, 404, errors.New("this guide has no HTML version"))
		return
	}
	raw, err := os.ReadFile(source)
	var doc guidedoc.Document
	if err != nil || json.Unmarshal(raw, &doc) != nil {
		writeErr(w, 500, errors.New("stored UI guide is unreadable"))
		return
	}
	dir := filepath.Dir(source)
	page, err := guidedoc.HTML(doc, func(name string) template.URL {
		png, err := os.ReadFile(filepath.Join(dir, filepath.Base(name)))
		if err != nil {
			return ""
		}
		return template.URL("data:image/png;base64," + base64.StdEncoding.EncodeToString(png))
	})
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Content-Security-Policy", guidePageCSP)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "private, no-cache")
	_, _ = w.Write([]byte(page))
}
