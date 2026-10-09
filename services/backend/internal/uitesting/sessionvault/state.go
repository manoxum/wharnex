package sessionvault

import (
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
)

const (
	MaxStateBytes   = 1 << 20
	maxCookies      = 200
	maxStorageItems = 500
)

// BrowserState is what the Desktop worker captures after a passed test: the
// page it ended on and the origin's cookies and web storage. It is a secret —
// it can hold authentication tokens — and is only ever stored sealed.
type BrowserState struct {
	URL            string            `json:"url"`
	Cookies        []BrowserCookie   `json:"cookies"`
	LocalStorage   map[string]string `json:"local_storage"`
	SessionStorage map[string]string `json:"session_storage"`
}

type BrowserCookie struct {
	Name           string  `json:"name"`
	Value          string  `json:"value"`
	Domain         string  `json:"domain,omitempty"`
	Path           string  `json:"path,omitempty"`
	Secure         bool    `json:"secure,omitempty"`
	HTTPOnly       bool    `json:"http_only,omitempty"`
	HostOnly       bool    `json:"host_only,omitempty"`
	ExpirationDate float64 `json:"expiration_date,omitempty"`
	SameSite       string  `json:"same_site,omitempty"`
}

// DecodeState strictly decodes and bounds a captured state for origin, and
// returns its canonical encoding.
func DecodeState(raw json.RawMessage, origin string) (BrowserState, []byte, error) {
	if len(raw) == 0 || len(raw) > MaxStateBytes {
		return BrowserState{}, nil, fmt.Errorf("UI test session state is empty or exceeds %d bytes", MaxStateBytes)
	}
	var state BrowserState
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&state); err != nil {
		return BrowserState{}, nil, fmt.Errorf("decode UI test session state: %w", err)
	}
	page, err := url.Parse(state.URL)
	if err != nil || page.Scheme+"://"+page.Host != origin {
		return BrowserState{}, nil, fmt.Errorf("UI test session state belongs to another origin")
	}
	if len(state.Cookies) > maxCookies || len(state.LocalStorage) > maxStorageItems || len(state.SessionStorage) > maxStorageItems {
		return BrowserState{}, nil, fmt.Errorf("UI test session state exceeds its item bounds")
	}
	host := page.Hostname()
	for _, cookie := range state.Cookies {
		if strings.TrimSpace(cookie.Name) == "" || !domainMatches(host, cookie.Domain) {
			return BrowserState{}, nil, fmt.Errorf("UI test session holds a cookie outside its origin")
		}
	}
	canonical, err := json.Marshal(state)
	if err != nil {
		return BrowserState{}, nil, err
	}
	return state, canonical, nil
}

// domainMatches applies RFC 6265 domain matching to a cookie's domain.
func domainMatches(host, domain string) bool {
	domain = strings.ToLower(strings.TrimPrefix(strings.TrimSpace(domain), "."))
	host = strings.ToLower(host)
	return domain == "" || host == domain || strings.HasSuffix(host, "."+domain)
}
