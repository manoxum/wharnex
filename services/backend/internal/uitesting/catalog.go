package uitesting

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"

	"kernl.local/harness/backend/internal/uitesting/testgraph"
)

const (
	AccessPublic        = "public"
	AccessAuthenticated = "authenticated"

	SourceDiscovered = "discovered"
	SourceUser       = "user"

	maxCatalogTests  = 400
	maxStrategySteps = 40
	maxListItems     = 12
)

// EffectiveAccess derives the access of a definition that predates `access`.
func EffectiveAccess(test TestCase) string {
	if test.Access == AccessPublic || test.Access == AccessAuthenticated {
		return test.Access
	}
	if test.ProfileID != "" || len(test.DependsOn) > 0 {
		return AccessAuthenticated
	}
	return AccessPublic
}

// DefinitionDigest fingerprints what a test does, never its execution state.
// A persisted session is valid only while every test it covers keeps the digest
// it was captured under.
func DefinitionDigest(test TestCase) string {
	test.Status, test.LastRunID, test.Source, test.Brief = "", "", "", ""
	raw, _ := json.Marshal(test)
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

// CatalogGraph builds the dependency graph of a catalog.
func CatalogGraph(tests []TestCase) (testgraph.Graph, error) {
	nodes := make([]testgraph.Node, 0, len(tests))
	for _, test := range tests {
		nodes = append(nodes, testgraph.Node{ID: test.ID, EnvironmentID: test.EnvironmentID, ProfileID: test.ProfileID, DependsOn: test.DependsOn})
	}
	return testgraph.New(nodes)
}

// validateCatalog checks a complete catalog: references, access rules and the
// dependency graph. It runs on the merged result, so a discovery may depend on
// tests that only the stored catalog contains.
func validateCatalog(environments []Environment, tests []TestCase) error {
	if len(tests) > maxCatalogTests {
		return fmt.Errorf("UI catalog exceeds %d tests", maxCatalogTests)
	}
	if err := validateReferences(environments, tests); err != nil {
		return err
	}
	graph, err := CatalogGraph(tests)
	if err != nil {
		return err
	}
	if err := graph.Validate(); err != nil {
		return err
	}
	byID := map[string]TestCase{}
	for _, test := range tests {
		byID[test.ID] = test
	}
	for _, test := range tests {
		profile, _ := graph.EffectiveProfile(test.ID)
		switch EffectiveAccess(test) {
		case AccessPublic:
			if profile != "" {
				return fmt.Errorf("public UI test %q cannot use or inherit profile %q", test.ID, profile)
			}
		case AccessAuthenticated:
			if profile == "" {
				return fmt.Errorf("authenticated UI test %q needs a profile or a dependency that logs in", test.ID)
			}
		}
	}
	return nil
}

// validateReferences checks only what merging can break: every test names an
// existing environment and, when it names one, a profile of that environment.
// Field-level rules are enforced on the incoming answer, so a stored catalog
// written under older rules can never block a later synchronization.
func validateReferences(environments []Environment, tests []TestCase) error {
	envByID := map[string]Environment{}
	for _, env := range environments {
		envByID[env.ID] = env
	}
	for _, test := range tests {
		env, exists := envByID[test.EnvironmentID]
		if !exists {
			return fmt.Errorf("UI test %q references unknown environment %q", test.ID, test.EnvironmentID)
		}
		if test.ProfileID != "" && !hasDiscoveryProfile(env, test.ProfileID) {
			return fmt.Errorf("UI test %q references unknown profile %q", test.ID, test.ProfileID)
		}
	}
	return nil
}

// validateDefinition bounds the detailed fields of one GPT-authored test.
func validateDefinition(test TestCase, requireAccess bool) error {
	if requireAccess && test.Access != AccessPublic && test.Access != AccessAuthenticated {
		return fmt.Errorf("UI test %q must declare access public or authenticated", test.ID)
	}
	if test.Access == AccessPublic && test.ProfileID != "" {
		return fmt.Errorf("public UI test %q must not name a profile", test.ID)
	}
	if len(test.Steps) > maxStrategySteps {
		return fmt.Errorf("UI test %q exceeds %d strategy steps", test.ID, maxStrategySteps)
	}
	for _, step := range test.Steps {
		if strings.TrimSpace(step.Action) == "" || len(step.Action) > 500 || len(step.Expected) > 500 {
			return fmt.Errorf("UI test %q has an invalid strategy step", test.ID)
		}
	}
	for _, list := range [][]string{test.Preconditions, test.TestData} {
		if err := boundedList(test.ID, list, 300); err != nil {
			return err
		}
	}
	if err := boundedList(test.ID, test.Tags, 40); err != nil {
		return err
	}
	bounds := []struct {
		value string
		limit int
	}{{test.Title, 160}, {test.Goal, 1000}, {test.Description, 2000}, {test.ExpectedResult, 1000}, {test.Category, 40}, {test.Priority, 20}, {test.Brief, MaxDesignBrief}}
	for _, bound := range bounds {
		if len(bound.value) > bound.limit {
			return fmt.Errorf("UI test %q has a field above its bound", test.ID)
		}
	}
	return nil
}

func boundedList(id string, values []string, limit int) error {
	if len(values) > maxListItems {
		return fmt.Errorf("UI test %q lists more than %d items", id, maxListItems)
	}
	for _, value := range values {
		if strings.TrimSpace(value) == "" || len(value) > limit {
			return fmt.Errorf("UI test %q has an invalid list item", id)
		}
	}
	return nil
}
