package uitesting

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"path"
	"strings"
)

func ParseDiscoveryResult(filename string, bundle []byte, request DiscoveryTransportManifest) (Discovery, error) {
	expected, err := DiscoveryResultFilename(request.TaskID)
	if err != nil {
		return Discovery{}, err
	}
	if filename != expected {
		return Discovery{}, fmt.Errorf("UI discovery bundle filename %q is not %q", filename, expected)
	}
	if len(bundle) == 0 || len(bundle) > MaxDiscoveryResultSize {
		return Discovery{}, fmt.Errorf("UI discovery bundle exceeds the transport limit")
	}
	reader, err := zip.NewReader(bytes.NewReader(bundle), int64(len(bundle)))
	if err != nil {
		return Discovery{}, fmt.Errorf("open UI discovery bundle: %w", err)
	}
	if len(reader.File) != 1 {
		return Discovery{}, fmt.Errorf("UI discovery bundle must contain exactly one entry")
	}
	entry := reader.File[0]
	name := strings.ReplaceAll(entry.Name, "\\", "/")
	if name != DiscoveryResultPath || path.Clean(name) != name || entry.FileInfo().IsDir() || entry.Mode()&0o120000 != 0 {
		return Discovery{}, fmt.Errorf("UI discovery bundle has an invalid result entry")
	}
	opened, err := entry.Open()
	if err != nil {
		return Discovery{}, fmt.Errorf("open UI discovery result: %w", err)
	}
	defer opened.Close()
	raw, err := io.ReadAll(io.LimitReader(opened, MaxDiscoveryResultSize+1))
	if err != nil || len(raw) > MaxDiscoveryResultSize {
		return Discovery{}, fmt.Errorf("read UI discovery result")
	}
	var result DiscoveryResult
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&result); err != nil {
		return Discovery{}, fmt.Errorf("decode UI discovery result: %w", err)
	}
	if result.Protocol != DiscoveryResultProtocolV1 || result.Task != DiscoveryTask || result.TaskID != request.TaskID || result.ContextSHA256 != request.ContextSHA256 || result.SourceSHA256 != request.SourceSHA256 {
		return Discovery{}, fmt.Errorf("UI discovery result does not match its request")
	}
	if err := validateDiscoveryCatalog(result.Environments, result.Tests); err != nil {
		return Discovery{}, err
	}
	return Discovery{ContextSHA256: result.ContextSHA256, Environments: result.Environments, Tests: result.Tests}, nil
}

func validateDiscoveryCatalog(environments []Environment, tests []TestCase) error {
	envByID := map[string]Environment{}
	for _, env := range environments {
		if !discoveryCatalogIDPattern.MatchString(env.ID) || strings.TrimSpace(env.Name) == "" {
			return fmt.Errorf("UI discovery contains an invalid environment")
		}
		if _, exists := envByID[env.ID]; exists {
			return fmt.Errorf("UI discovery contains a duplicate environment id")
		}
		profiles := map[string]bool{}
		for _, profile := range env.Profiles {
			if !discoveryCatalogIDPattern.MatchString(profile.ID) || strings.TrimSpace(profile.Label) == "" || strings.TrimSpace(profile.Role) == "" || profiles[profile.ID] {
				return fmt.Errorf("UI discovery contains an invalid profile")
			}
			profiles[profile.ID] = true
		}
		envByID[env.ID] = env
	}
	testIDs := map[string]bool{}
	for _, test := range tests {
		if !discoveryCatalogIDPattern.MatchString(test.ID) || strings.TrimSpace(test.Title) == "" || strings.TrimSpace(test.Goal) == "" || testIDs[test.ID] {
			return fmt.Errorf("UI discovery contains an invalid test")
		}
		env, exists := envByID[test.EnvironmentID]
		if !exists {
			return fmt.Errorf("UI discovery test references an unknown environment")
		}
		if test.ProfileID != "" && !hasDiscoveryProfile(env, test.ProfileID) {
			return fmt.Errorf("UI discovery test references an unknown profile")
		}
		testIDs[test.ID] = true
	}
	return nil
}

func hasDiscoveryProfile(environment Environment, profileID string) bool {
	for _, profile := range environment.Profiles {
		if profile.ID == profileID {
			return true
		}
	}
	return false
}
