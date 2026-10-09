package httpapi

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/uitesting"
	"kernl.local/harness/backend/internal/uitesting/sessionvault"
	"kernl.local/harness/backend/internal/uitesting/testgraph"
)

const runProtocolV2 = "harness.ui-test-run/v2"

type chainItem struct {
	RunID string             `json:"run_id"`
	Role  string             `json:"role"`
	Test  uitesting.TestCase `json:"test"`
}

type restorePoint struct {
	SessionID string   `json:"session_id"`
	TestID    string   `json:"test_id"`
	Covers    []string `json:"covers"`
}

type runEnvironment struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	URL  string `json:"url"`
}

type runProfile struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Role  string `json:"role"`
}

// runPayload is the UI_TEST_RUN task body. A v1 payload has no chain: its
// only run is RunID. In v2, Chain is what the worker executes — the
// prerequisites after the restore point, then the selected test — and
// FullChain is every prerequisite plus the test, run from a clean browser
// when the restored session proves invalid.
type runPayload struct {
	Protocol    string             `json:"protocol"`
	RunID       string             `json:"run_id"`
	Test        uitesting.TestCase `json:"test"`
	Environment runEnvironment     `json:"environment"`
	Profile     runProfile         `json:"profile"`
	Chain       []chainItem        `json:"chain,omitempty"`
	FullChain   []chainItem        `json:"full_chain,omitempty"`
	Restore     *restorePoint      `json:"restore,omitempty"`
	MaxSteps    int                `json:"max_steps"`
}

// chainRun finds a run the payload authorizes, with its position in FullChain.
func (p runPayload) chainRun(runID string) (chainItem, int, bool) {
	if len(p.FullChain) == 0 {
		return chainItem{RunID: p.RunID, Role: uitesting.RunRoleTarget, Test: p.Test}, 0, runID == p.RunID
	}
	for i, item := range p.FullChain {
		if item.RunID == runID {
			return item, i, true
		}
	}
	return chainItem{}, -1, false
}

// planRun resolves the selected test's prerequisites, checks their local
// configuration and picks the deepest reusable persisted session.
func (h *Routes) planRun(ctx context.Context, project string, doc uitesting.Document, test uitesting.TestCase, runID string, mustRun map[string]bool) (runPayload, error) {
	graph, err := uitesting.CatalogGraph(doc.Tests)
	if err != nil {
		return runPayload{}, err
	}
	order, err := graph.Order(test.ID)
	if err != nil {
		return runPayload{}, err
	}
	profileID, err := graph.EffectiveProfile(test.ID)
	if err != nil {
		return runPayload{}, err
	}
	env, profile, err := configuredTarget(doc, test.EnvironmentID, profileID)
	if err != nil {
		return runPayload{}, fmt.Errorf("%s: %w", test.Title, err)
	}
	origin, err := environmentOrigin(env.URL)
	if err != nil {
		return runPayload{}, err
	}
	tests := map[string]uitesting.TestCase{}
	for _, item := range doc.Tests {
		tests[item.ID] = item
	}
	payload := runPayload{Protocol: runProtocolV2, RunID: runID, Test: test, MaxSteps: 24,
		Environment: runEnvironment{ID: env.ID, Name: env.Name, URL: env.URL},
		Profile:     runProfile{ID: profile.ID, Label: profile.Label, Role: profile.Role}}
	for i, id := range order {
		payload.FullChain = append(payload.FullChain, chainItem{RunID: fmt.Sprintf("%s_d%d", runID, i+1), Role: uitesting.RunRoleDependency, Test: tests[id]})
	}
	payload.FullChain = append(payload.FullChain, chainItem{RunID: runID, Role: uitesting.RunRoleTarget, Test: test})
	index, snapshot := sessionvault.Plan(h.planInput(ctx, project, doc, graph, env.ID, origin, order, mustRun))
	if index >= 0 {
		payload.Restore = &restorePoint{SessionID: snapshot.SID, TestID: snapshot.TestID, Covers: snapshot.Covers}
	}
	payload.Chain = payload.FullChain[index+1:]
	return payload, nil
}

func (h *Routes) planInput(ctx context.Context, project string, doc uitesting.Document, graph testgraph.Graph, envID, origin string, order []string, mustRun map[string]bool) sessionvault.PlanInput {
	input := sessionvault.PlanInput{EnvironmentID: envID, Origin: origin, Order: order, MustRun: mustRun, Now: time.Now().UTC(),
		Profiles: map[string]string{}, Digests: map[string]string{}}
	for _, test := range doc.Tests {
		input.Digests[test.ID] = uitesting.DefinitionDigest(test)
	}
	for _, id := range order {
		input.Profiles[id], _ = graph.EffectiveProfile(id)
	}
	// A vault that cannot answer only costs a full chain; it never blocks a run.
	input.Snapshots, _ = h.vault.List(ctx, project, input.Now)
	return input
}

func configuredTarget(doc uitesting.Document, environmentID, profileID string) (uitesting.Environment, uitesting.Profile, error) {
	for _, env := range doc.Environments {
		if env.ID != environmentID {
			continue
		}
		if strings.TrimSpace(env.URL) == "" {
			return env, uitesting.Profile{}, errors.New("test environment URL is not configured")
		}
		if profileID == "" {
			return env, uitesting.Profile{}, nil
		}
		for _, profile := range env.Profiles {
			if profile.ID == profileID {
				if !profile.Configured {
					return env, profile, errors.New("test profile credentials are not configured")
				}
				return env, profile, nil
			}
		}
		return env, uitesting.Profile{}, errors.New("test profile is not defined")
	}
	return uitesting.Environment{}, uitesting.Profile{}, errors.New("test environment is not defined")
}

func environmentOrigin(raw string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return "", errors.New("test environment URL must be an absolute http(s) URL")
	}
	return parsed.Scheme + "://" + parsed.Host, nil
}
