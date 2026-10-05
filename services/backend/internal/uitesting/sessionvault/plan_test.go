package sessionvault

import (
	"encoding/json"
	"testing"
	"time"
)

func planFixture(now time.Time) PlanInput {
	return PlanInput{
		EnvironmentID: "web", Origin: "https://app.test",
		Order:    []string{"login", "open-project"},
		Profiles: map[string]string{"login": "admin", "open-project": "admin"},
		Digests:  map[string]string{"login": "d-login", "open-project": "d-open", "create-item": "d-create"},
		Now:      now,
	}
}

func snapshot(test string, covers []string, digests map[string]string, now time.Time) Snapshot {
	return Snapshot{SID: "uts_" + test, EnvironmentID: "web", TestID: test, ProfileID: "admin", Origin: "https://app.test",
		Covers: covers, Digests: digests, CapturedAt: now, ExpiresAt: now.Add(TTL)}
}

func TestPlanResumesFromDeepestValidPrerequisite(t *testing.T) {
	now := time.Now()
	input := planFixture(now)
	input.Snapshots = []Snapshot{
		snapshot("login", []string{"login"}, map[string]string{"login": "d-login"}, now),
		snapshot("open-project", []string{"login", "open-project"}, map[string]string{"login": "d-login", "open-project": "d-open"}, now),
	}
	if index, chosen := Plan(input); index != 1 || chosen.TestID != "open-project" {
		t.Fatalf("index=%d chosen=%s", index, chosen.TestID)
	}
}

func TestPlanRejectsStaleOrForeignSnapshots(t *testing.T) {
	now := time.Now()
	login := map[string]string{"login": "d-login"}
	cases := map[string]Snapshot{
		"expired":           func() Snapshot { s := snapshot("login", []string{"login"}, login, now); s.ExpiresAt = now; return s }(),
		"definition change": snapshot("login", []string{"login"}, map[string]string{"login": "old"}, now),
		"origin": func() Snapshot {
			s := snapshot("login", []string{"login"}, login, now)
			s.Origin = "https://evil.test"
			return s
		}(),
		"profile": func() Snapshot {
			s := snapshot("login", []string{"login"}, login, now)
			s.ProfileID = "viewer"
			return s
		}(),
		"incomplete": snapshot("open-project", []string{"open-project"}, map[string]string{"open-project": "d-open"}, now),
	}
	for name, candidate := range cases {
		t.Run(name, func(t *testing.T) {
			input := planFixture(now)
			input.Snapshots = []Snapshot{candidate}
			if index, _ := Plan(input); index != -1 {
				t.Fatalf("unsafe snapshot reused at %d", index)
			}
		})
	}
}

func TestPlanNeverSkipsAnExplicitlySelectedPrerequisite(t *testing.T) {
	now := time.Now()
	input := planFixture(now)
	input.MustRun = map[string]bool{"open-project": true}
	input.Snapshots = []Snapshot{
		snapshot("login", []string{"login"}, map[string]string{"login": "d-login"}, now),
		snapshot("open-project", []string{"login", "open-project"}, map[string]string{"login": "d-login", "open-project": "d-open"}, now),
	}
	if index, chosen := Plan(input); index != 0 || chosen.TestID != "login" {
		t.Fatalf("index=%d chosen=%s", index, chosen.TestID)
	}
}

func TestDecodeStateBindsCookiesAndPageToTheOrigin(t *testing.T) {
	valid := `{"url":"https://app.test/home","cookies":[{"name":"sid","value":"x","domain":".app.test"}],"local_storage":{"token":"t"},"session_storage":{}}`
	if _, canonical, err := DecodeState(json.RawMessage(valid), "https://app.test"); err != nil || len(canonical) == 0 {
		t.Fatalf("err=%v", err)
	}
	for name, raw := range map[string]string{
		"page":    `{"url":"https://evil.test/","cookies":[],"local_storage":{},"session_storage":{}}`,
		"cookie":  `{"url":"https://app.test/","cookies":[{"name":"sid","value":"x","domain":"evil.test"}],"local_storage":{},"session_storage":{}}`,
		"unknown": `{"url":"https://app.test/","cookies":[],"local_storage":{},"session_storage":{},"script":"x"}`,
	} {
		if _, _, err := DecodeState(json.RawMessage(raw), "https://app.test"); err == nil {
			t.Fatalf("%s: foreign state accepted", name)
		}
	}
}
