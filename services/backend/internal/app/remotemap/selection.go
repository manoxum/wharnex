package remotemap

import (
	"strings"

	"kernl.local/harness/backend/internal/directives"
	"kernl.local/harness/backend/internal/domain"
)

// FromPrompt admits only already-eligible file bodies named by the durable
// operator request, including the eligible descendants of a named directory.
func FromPrompt(contextPaths []string, prompt string, manifest domain.ContextManifest) []string {
	var files []string
	for _, value := range directives.Values(directives.Parse(prompt), directives.KindFile) {
		for _, file := range manifest.Files {
			if file.Path == value || strings.HasPrefix(file.Path, strings.TrimSuffix(value, "/")+"/") {
				files = append(files, file.Path)
			}
		}
	}
	return Select(contextPaths, files)
}

// Select retains source-qualified context selections and adds explicitly
// authorized primary-project references in that same namespace.
func Select(contextPaths, projectFiles []string) []string {
	result := append([]string(nil), contextPaths...)
	seen := make(map[string]bool, len(result))
	for _, value := range result {
		seen[value] = true
	}
	for _, value := range projectFiles {
		value = "context/" + value
		if !seen[value] {
			result = append(result, value)
			seen[value] = true
		}
	}
	return result
}

// RetainSelections preserves authorized selections when the live monitor
// rebuilds the snapshot without the original publication request.
func RetainSelections(contextPaths []string, previous []Entry) []string {
	var files []string
	for _, entry := range previous {
		if entry.Role == "context" && entry.Selected {
			files = append(files, entry.Path)
		}
	}
	return Select(contextPaths, files)
}

func selectedPaths(values []string) map[string]bool {
	selected := make(map[string]bool, len(values))
	for _, value := range values {
		// The context manifest uses project-relative paths; selection paths
		// use the request archive's source namespace.
		selected[strings.TrimPrefix(value, "context/")] = true
	}
	return selected
}
