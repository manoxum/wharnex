package sandboxenv

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// TestHarness describes one JavaScript/TypeScript package's own test setup:
// the command that runs it, the runner it uses, and the assertion extensions
// that are actually registered.
//
// It exists for the same reason the tools inventory does. A planner that cannot
// see this guesses, and the guess is expensive in exactly the same way: a
// verification round spent to discover the answer. The observed failure was a
// generated test calling `toHaveAttribute`, a jest-dom matcher, in a project
// that has never depended on jest-dom — every neighbouring test in the same
// file uses `toBeTruthy()`. Vitest reports it as `Invalid Chai property`, which
// reads like a defect in the change rather than a missing capability, and costs
// a full model turn, a container run and the whole suite to learn.
type TestHarness struct {
	// Package is the project-relative directory holding this package.json.
	Package string `json:"package"`
	// Command is the package's own test script, as declared.
	Command string `json:"command,omitempty"`
	// Runner is the detected test runner, empty when none is recognised.
	Runner string `json:"runner,omitempty"`
	// AssertionExtensions lists declared packages that register extra matchers.
	// An EMPTY list is the load-bearing case: it means only the runner's own
	// built-in matchers exist, and any other matcher will fail at run time.
	AssertionExtensions []string `json:"assertion_extensions"`
	// Libraries lists the declared testing libraries a test may import.
	Libraries []string `json:"libraries,omitempty"`
}

// maxProbedPackages bounds the inventory. A monorepo with hundreds of packages
// would otherwise turn a descriptive section into the bulk of the prompt.
const maxProbedPackages = 12

// assertionExtensionPackages are the dependency names that, when declared,
// register matchers beyond a runner's built-ins. Kept as an explicit list
// rather than a heuristic: reporting a matcher set the project does not have is
// worse than reporting none, because it is the exact mistake this section
// exists to prevent.
var assertionExtensionPackages = map[string]bool{
	"@testing-library/jest-dom": true,
	"jest-extended":             true,
	"chai-as-promised":          true,
	"jest-styled-components":    true,
	"vitest-axe":                true,
}

var testingLibraryPackages = map[string]bool{
	"@testing-library/react":       true,
	"@testing-library/dom":         true,
	"@testing-library/user-event":  true,
	"@testing-library/vue":         true,
	"@testing-library/svelte":      true,
	"@playwright/test":             true,
	"react-test-renderer":          true,
	"@vue/test-utils":              true,
	"enzyme":                       true,
	"supertest":                    true,
	"msw":                          true,
	"@testing-library/react-hooks": true,
}

var testRunnerPackages = []string{"vitest", "jest", "mocha", "ava", "node:test"}

// probeTestHarnesses measures every package.json under the project that
// declares a test script, bounded in both depth and count.
func probeTestHarnesses(projectPath string) []TestHarness {
	root := strings.TrimSpace(projectPath)
	if root == "" {
		return nil
	}
	harnesses := make([]TestHarness, 0)
	for _, manifestPath := range findPackageManifests(root) {
		if harness, ok := readTestHarness(root, manifestPath); ok {
			harnesses = append(harnesses, harness)
		}
		if len(harnesses) >= maxProbedPackages {
			break
		}
	}
	sort.SliceStable(harnesses, func(i, j int) bool { return harnesses[i].Package < harnesses[j].Package })
	return harnesses
}

// findPackageManifests walks a bounded slice of the tree: the project root and
// the conventional service/package directories one and two levels below it.
// Dependency and build directories are never descended into.
func findPackageManifests(root string) []string {
	found := make([]string, 0, maxProbedPackages)
	add := func(dir string) {
		candidate := filepath.Join(dir, "package.json")
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			found = append(found, candidate)
		}
	}
	add(root)
	for _, container := range []string{".", "services", "packages", "apps"} {
		entries, err := os.ReadDir(filepath.Join(root, container))
		if err != nil {
			continue
		}
		for _, entry := range entries {
			if !entry.IsDir() || skippedPackageDir(entry.Name()) {
				continue
			}
			add(filepath.Join(root, container, entry.Name()))
			if len(found) >= maxProbedPackages {
				return found
			}
		}
	}
	return found
}

func skippedPackageDir(name string) bool {
	switch name {
	case "node_modules", "dist", "build", "out", "coverage", ".git", "vendor":
		return true
	}
	return strings.HasPrefix(name, ".")
}

func readTestHarness(root, manifestPath string) (TestHarness, bool) {
	raw, err := os.ReadFile(manifestPath)
	if err != nil || len(raw) > 1<<20 {
		return TestHarness{}, false
	}
	var document struct {
		Scripts         map[string]string `json:"scripts"`
		Dependencies    map[string]string `json:"dependencies"`
		DevDependencies map[string]string `json:"devDependencies"`
	}
	if err := json.Unmarshal(raw, &document); err != nil {
		return TestHarness{}, false
	}
	command := strings.TrimSpace(document.Scripts["test"])
	if command == "" {
		return TestHarness{}, false
	}
	relative, err := filepath.Rel(root, filepath.Dir(manifestPath))
	if err != nil {
		return TestHarness{}, false
	}
	harness := TestHarness{
		Package:             filepath.ToSlash(relative),
		Command:             command,
		AssertionExtensions: make([]string, 0),
	}
	declared := map[string]bool{}
	for _, set := range []map[string]string{document.Dependencies, document.DevDependencies} {
		for name := range set {
			declared[name] = true
		}
	}
	for name := range declared {
		if assertionExtensionPackages[name] {
			harness.AssertionExtensions = append(harness.AssertionExtensions, name)
		}
		if testingLibraryPackages[name] {
			harness.Libraries = append(harness.Libraries, name)
		}
	}
	for _, runner := range testRunnerPackages {
		if declared[runner] || strings.Contains(command, runner) {
			harness.Runner = runner
			break
		}
	}
	sort.Strings(harness.AssertionExtensions)
	sort.Strings(harness.Libraries)
	return harness, true
}
