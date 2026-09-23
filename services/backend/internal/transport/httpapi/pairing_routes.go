package httpapi

import (
	"encoding/base64"
	"net/http"
	"net/url"
	"strings"
	"time"

	qrcode "github.com/skip2/go-qrcode"
)

const remotePairingCookie = "wharnex_remote_session"

func (a *API) remotePairingAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Wharnex-Remote") != "1" || pairingPublicPath(r.URL.Path) {
			next.ServeHTTP(w, r)
			return
		}
		cookie, err := r.Cookie(remotePairingCookie)
		if err != nil || a.pairingStore == nil || !a.pairingStore.Authenticate(cookie.Value) {
			writeError(w, http.StatusUnauthorized, "remote_pairing_required", "pair this browser with Wharnex Desktop before using remote controls")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func pairingPublicPath(path string) bool {
	return path == "/api/health" || path == "/api/pairing/claim" || path == "/api/pairing/status"
}

func (a *API) startPairing(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("X-Wharnex-Remote") == "1" {
		writeError(w, http.StatusForbidden, "pairing_local_only", "pairing must be started from the local Wharnex interface")
		return
	}
	var body struct {
		InstanceID string `json:"instance_id"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	publicURL := ""
	for _, instance := range a.tunnelStatus().Instances {
		if instance.ID == strings.TrimSpace(body.InstanceID) && instance.PublicURL != "" && instance.Available {
			publicURL = strings.TrimRight(instance.PublicURL, "/")
			break
		}
	}
	if publicURL == "" {
		writeError(w, http.StatusNotFound, "tunnel_not_ready", "the selected tunnel has no active public URL")
		return
	}
	code, expiresAt, err := a.pairingStore.Begin()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "pairing_start_failed", err.Error())
		return
	}
	pairingURL := publicURL + "/?pair=" + url.QueryEscape(code)
	image, err := qrcode.Encode(pairingURL, qrcode.Medium, 320)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "pairing_qr_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"pairing_url": pairingURL,
		"qr_code":     "data:image/png;base64," + base64.StdEncoding.EncodeToString(image),
		"expires_at":  expiresAt.Format(time.RFC3339),
	})
}

func (a *API) claimPairing(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("X-Wharnex-Remote") != "1" {
		writeError(w, http.StatusForbidden, "pairing_remote_only", "pairing codes can only be claimed through a remote tunnel")
		return
	}
	var body struct {
		Code string `json:"code"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	token, err := a.pairingStore.Claim(strings.TrimSpace(body.Code))
	if err != nil {
		writeError(w, http.StatusUnauthorized, "pairing_invalid", err.Error())
		return
	}
	http.SetCookie(w, pairingCookie(r, token, time.Now().Add(30*24*time.Hour)))
	writeJSON(w, http.StatusOK, map[string]any{"paired": true})
}

func (a *API) pairingStatus(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("X-Wharnex-Remote") != "1" {
		writeJSON(w, http.StatusOK, map[string]any{"paired": true, "remote": false})
		return
	}
	cookie, err := r.Cookie(remotePairingCookie)
	paired := err == nil && a.pairingStore != nil && a.pairingStore.Authenticate(cookie.Value)
	writeJSON(w, http.StatusOK, map[string]any{"paired": paired, "remote": true})
}

func (a *API) endPairingSession(w http.ResponseWriter, r *http.Request) {
	if cookie, err := r.Cookie(remotePairingCookie); err == nil && a.pairingStore != nil {
		if revokeErr := a.pairingStore.Revoke(cookie.Value); revokeErr != nil {
			writeError(w, http.StatusInternalServerError, "pairing_revoke_failed", revokeErr.Error())
			return
		}
	}
	http.SetCookie(w, pairingCookie(r, "", time.Unix(1, 0)))
	w.WriteHeader(http.StatusNoContent)
}

func pairingCookie(r *http.Request, value string, expires time.Time) *http.Cookie {
	secure := r.Header.Get("X-Wharnex-Remote") == "1" || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https") || r.TLS != nil
	return &http.Cookie{Name: remotePairingCookie, Value: value, Path: "/", HttpOnly: true, Secure: secure, SameSite: http.SameSiteLaxMode, Expires: expires, MaxAge: cookieMaxAge(expires)}
}

func cookieMaxAge(expires time.Time) int {
	if expires.Before(time.Now()) {
		return -1
	}
	return int(time.Until(expires).Seconds())
}
