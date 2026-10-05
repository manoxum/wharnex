package exchange

import (
	"fmt"
	"net/url"
	"strings"
)

// Action is one typed browser action. The set is closed: the executor never
// receives script, arbitrary keys or another origin's URL.
type Action struct {
	Action   string `json:"action"`
	Caption  string `json:"caption,omitempty"`
	Selector string `json:"selector,omitempty"`
	Value    string `json:"value,omitempty"`
	Field    string `json:"field,omitempty"`
	Key      string `json:"key,omitempty"`
	URL      string `json:"url,omitempty"`
	Ms       int    `json:"ms,omitempty"`
	Text     string `json:"text,omitempty"`
	Status   string `json:"status,omitempty"`
}

var (
	allowedKeys      = map[string]bool{"Enter": true, "Escape": true, "Tab": true, "ArrowDown": true, "ArrowUp": true, "Space": true}
	selectorRequired = map[string]bool{"click": true, "fill": true, "fill_credential": true, "press": true, "assert_text": true}
)

// ActionRules are the request-specific limits an answer must respect.
type ActionRules struct {
	Origin               string
	CurrentURL           string
	AllowSessionInvalid  bool
	CredentialsAvailable bool
}

// Normalize validates an action and returns its canonical form.
func (a Action) Normalize(rules ActionRules) (Action, error) {
	out := Action{Action: a.Action, Caption: strings.TrimSpace(a.Caption)}
	if len(out.Caption) > 240 {
		return Action{}, fmt.Errorf("UI action caption exceeds its bound")
	}
	if selectorRequired[a.Action] {
		out.Selector = strings.TrimSpace(a.Selector)
		if out.Selector == "" || len(out.Selector) > 500 {
			return Action{}, fmt.Errorf("UI action %s needs a selector of at most 500 characters", a.Action)
		}
	}
	switch a.Action {
	case "click":
	case "fill":
		if len(a.Value) > 4000 {
			return Action{}, fmt.Errorf("UI fill value exceeds its bound")
		}
		out.Value = a.Value
	case "fill_credential":
		if a.Field != "username" && a.Field != "password" {
			return Action{}, fmt.Errorf("credential action requires username or password")
		}
		if !rules.CredentialsAvailable {
			return Action{}, fmt.Errorf("this test has no configured credentials: use fill with the values from test_data (for example deliberately invalid credentials)")
		}
		out.Field = a.Field
	case "press":
		if !allowedKeys[a.Key] {
			return Action{}, fmt.Errorf("UI key %q is not allowed", a.Key)
		}
		out.Key = a.Key
	case "wait":
		out.Ms = min(5000, max(50, a.Ms))
	case "assert_text":
		out.Text = strings.TrimSpace(a.Text)
		if out.Text == "" || len(out.Text) > 500 {
			return Action{}, fmt.Errorf("UI assert_text needs text of at most 500 characters")
		}
	case "navigate":
		target, err := resolveSameOrigin(a.URL, rules)
		if err != nil {
			return Action{}, err
		}
		out.URL = target
	case "finish":
		switch {
		case a.Status == "passed" || a.Status == "failed":
			out.Status = a.Status
		case a.Status == "session_invalid" && rules.AllowSessionInvalid:
			out.Status = a.Status
		default:
			return Action{}, fmt.Errorf("UI finish status %q is not allowed here", a.Status)
		}
	default:
		return Action{}, fmt.Errorf("unsupported UI action %q", a.Action)
	}
	return out, nil
}

func resolveSameOrigin(raw string, rules ActionRules) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" || len(raw) > 2048 {
		return "", fmt.Errorf("UI navigate needs a URL of at most 2048 characters")
	}
	base, err := url.Parse(rules.CurrentURL)
	if err != nil || base.Host == "" {
		base, err = url.Parse(rules.Origin)
		if err != nil {
			return "", fmt.Errorf("UI navigation has no valid base URL")
		}
	}
	target, err := base.Parse(raw)
	if err != nil || target.Scheme+"://"+target.Host != rules.Origin {
		return "", fmt.Errorf("UI navigation must stay on %s", rules.Origin)
	}
	return target.String(), nil
}
