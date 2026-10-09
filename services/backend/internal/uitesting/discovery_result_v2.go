package uitesting

import (
	"fmt"
	"strings"
)

// DiscoveryResultV2 is an incremental answer: new or revised environments and
// tests, plus the discovered tests that no longer apply. Tests GPT omits are
// kept, because the request carried the whole current catalog.
type DiscoveryResultV2 struct {
	Protocol        string        `json:"protocol"`
	Task            string        `json:"task"`
	TaskID          string        `json:"task_id"`
	ContextSHA256   string        `json:"context_sha256"`
	SourceSHA256    string        `json:"source_sha256"`
	CatalogSHA256   string        `json:"catalog_sha256"`
	Summary         string        `json:"summary"`
	Environments    []Environment `json:"environments"`
	Tests           []TestCase    `json:"tests"`
	ObsoleteTestIDs []string      `json:"obsolete_test_ids"`
	// Optional so answers to requests issued before the field existed stay valid.
	ObsoleteEnvironmentIDs []string `json:"obsolete_environment_ids,omitempty"`
}

func parseDiscoveryResultV2(raw []byte, request DiscoveryTransportManifest) (Discovery, error) {
	var result DiscoveryResultV2
	if err := decodeSingleDocument(raw, &result); err != nil {
		return Discovery{}, err
	}
	if result.Protocol != DiscoveryResultProtocolV2 || result.Task != request.Task || result.TaskID != request.TaskID ||
		result.ContextSHA256 != request.ContextSHA256 || result.SourceSHA256 != request.SourceSHA256 || result.CatalogSHA256 != request.CatalogSHA256 {
		return Discovery{}, fmt.Errorf("UI discovery result does not match its request")
	}
	if len(result.Summary) > 4000 {
		return Discovery{}, fmt.Errorf("UI discovery summary exceeds its bound")
	}
	if err := validateResultShape(result); err != nil {
		return Discovery{}, err
	}
	origin := DiscoveryOriginSync
	if request.Task == DesignTask {
		origin = DiscoveryOriginDesign
		if len(result.Tests) == 0 || len(result.ObsoleteTestIDs) > 0 || len(result.ObsoleteEnvironmentIDs) > 0 {
			return Discovery{}, fmt.Errorf("UI test design must add tests and may not retire any")
		}
	}
	return Discovery{
		ContextSHA256: result.ContextSHA256, Origin: origin, Summary: strings.TrimSpace(result.Summary),
		Environments: result.Environments, Tests: result.Tests, ObsoleteTestIDs: result.ObsoleteTestIDs, ObsoleteEnvironmentIDs: result.ObsoleteEnvironmentIDs,
	}, nil
}

// ValidateProposedTests applies the discovery field rules to tests a guide
// review proposes for uncovered interface elements.
func ValidateProposedTests(tests []TestCase) error {
	return validateResultShape(DiscoveryResultV2{Tests: tests})
}

// validateResultShape checks what the answer alone can prove. References to
// environments, profiles and dependencies are resolved against the merged
// catalog by the store, because the answer may build on stored tests.
func validateResultShape(result DiscoveryResultV2) error {
	environments := map[string]bool{}
	for _, env := range result.Environments {
		if !discoveryCatalogIDPattern.MatchString(env.ID) || strings.TrimSpace(env.Name) == "" || environments[env.ID] {
			return fmt.Errorf("UI discovery contains an invalid environment")
		}
		environments[env.ID] = true
		profiles := map[string]bool{}
		for _, profile := range env.Profiles {
			if !discoveryCatalogIDPattern.MatchString(profile.ID) || strings.TrimSpace(profile.Label) == "" || strings.TrimSpace(profile.Role) == "" || profiles[profile.ID] {
				return fmt.Errorf("UI discovery contains an invalid profile")
			}
			profiles[profile.ID] = true
		}
	}
	tests := map[string]bool{}
	for _, test := range result.Tests {
		if !discoveryCatalogIDPattern.MatchString(test.ID) || strings.TrimSpace(test.Title) == "" || strings.TrimSpace(test.Goal) == "" || tests[test.ID] {
			return fmt.Errorf("UI discovery contains an invalid test")
		}
		if !discoveryCatalogIDPattern.MatchString(test.EnvironmentID) || (test.ProfileID != "" && !discoveryCatalogIDPattern.MatchString(test.ProfileID)) {
			return fmt.Errorf("UI discovery test %q has an invalid reference", test.ID)
		}
		if err := validateDefinition(test, true); err != nil {
			return err
		}
		tests[test.ID] = true
	}
	for _, id := range result.ObsoleteEnvironmentIDs {
		if !discoveryCatalogIDPattern.MatchString(id) || environments[id] {
			return fmt.Errorf("UI discovery retires an invalid environment id")
		}
	}
	if len(result.ObsoleteTestIDs) > maxCatalogTests {
		return fmt.Errorf("UI discovery retires too many tests")
	}
	for _, id := range result.ObsoleteTestIDs {
		if !discoveryCatalogIDPattern.MatchString(id) || tests[id] {
			return fmt.Errorf("UI discovery retires an invalid test id")
		}
	}
	return nil
}
