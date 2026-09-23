package httpapi

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"kernl.local/harness/backend/internal/pairing"
)

func TestRemotePairingAuthRequiresClaimedSession(t *testing.T) {
	store := pairing.NewStore(filepath.Join(t.TempDir(), "pairing.json"))
	code, _, err := store.Begin()
	if err != nil {
		t.Fatal(err)
	}
	token, err := store.Claim(code)
	if err != nil {
		t.Fatal(err)
	}
	api := &API{pairingStore: store}
	handler := api.remotePairingAuth(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) }))

	unpaired := httptest.NewRequest(http.MethodGet, "/api/config", nil)
	unpaired.Header.Set("X-Wharnex-Remote", "1")
	unpairedResponse := httptest.NewRecorder()
	handler.ServeHTTP(unpairedResponse, unpaired)
	if unpairedResponse.Code != http.StatusUnauthorized {
		t.Fatalf("unpaired status = %d", unpairedResponse.Code)
	}

	paired := httptest.NewRequest(http.MethodGet, "/api/config", nil)
	paired.Header.Set("X-Wharnex-Remote", "1")
	paired.AddCookie(&http.Cookie{Name: remotePairingCookie, Value: token})
	pairedResponse := httptest.NewRecorder()
	handler.ServeHTTP(pairedResponse, paired)
	if pairedResponse.Code != http.StatusNoContent {
		t.Fatalf("paired status = %d", pairedResponse.Code)
	}
}

func TestRemotePairingCookieIsSecureOnMarkedIngress(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/api/pairing/claim", nil)
	request.Header.Set("X-Wharnex-Remote", "1")
	cookie := pairingCookie(request, "token", time.Now().Add(time.Hour))
	if !cookie.HttpOnly || !cookie.Secure || cookie.SameSite != http.SameSiteLaxMode {
		t.Fatalf("unexpected remote cookie flags: %#v", cookie)
	}
}
