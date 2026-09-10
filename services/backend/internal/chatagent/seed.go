package chatagent

import (
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"path"
	"sort"
	"strings"
)

// The seed documents ship with the backend binary so a fresh deployment always
// has a known-good behavior to migrate into the database, with no dependency on
// a file being present on disk beside the process.
//
//go:embed behaviors/*.json
var seedFS embed.FS

// Seed returns the embedded document for a provider.
func Seed(provider string) (Document, error) {
	name := strings.ToLower(strings.TrimSpace(provider))
	if name == "" || strings.ContainsAny(name, "/\\.") {
		return Document{}, fmt.Errorf("%w: %q", ErrUnknownProvider, provider)
	}
	raw, err := seedFS.ReadFile(path.Join("behaviors", name+".json"))
	if err != nil {
		return Document{}, fmt.Errorf("%w: %q", ErrUnknownProvider, provider)
	}
	var doc Document
	if err := json.Unmarshal(raw, &doc); err != nil {
		return Document{}, fmt.Errorf("decode seeded behavior %q: %w", provider, err)
	}
	doc = doc.Normalized()
	if err := doc.Validate(); err != nil {
		// A broken seed is a build defect, not a runtime condition.
		return Document{}, fmt.Errorf("seeded behavior %q is invalid: %w", provider, err)
	}
	return doc, nil
}

// SeededProviders lists every provider that ships with a behavior document.
func SeededProviders() []string {
	entries, err := fs.ReadDir(seedFS, "behaviors")
	if err != nil {
		return nil
	}
	providers := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		providers = append(providers, strings.TrimSuffix(entry.Name(), ".json"))
	}
	sort.Strings(providers)
	return providers
}
