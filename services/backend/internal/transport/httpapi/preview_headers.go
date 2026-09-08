package httpapi

import (
	"net/http"
	"strings"
)

const sandboxedHTMLCSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"

func applyPreviewSecurityHeaders(w http.ResponseWriter, contentType string) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "private, no-store")
	if !strings.HasPrefix(strings.ToLower(strings.TrimSpace(contentType)), "text/html") {
		return
	}
	w.Header().Set("Content-Security-Policy", sandboxedHTMLCSP)
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("Cross-Origin-Resource-Policy", "same-origin")
}
