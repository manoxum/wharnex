package app

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"

	"kernl.local/harness/backend/internal/domain"
)

// protectedNodePackages are the npm workspaces whose host/self-evolution build
// uses npm ci. A dependency-map edit is incomplete unless the candidate also
// retains the corresponding package-lock.json as executable patch content.
var protectedNodePackages = []struct {
	Manifest string
	Lockfile string
}{
	{Manifest: "services/frontend/package.json", Lockfile: "services/frontend/package-lock.json"},
	{Manifest: "services/webapp/package.json", Lockfile: "services/webapp/package-lock.json"},
	{Manifest: "services/desktop/package.json", Lockfile: "services/desktop/package-lock.json"},
}

// nodeDependencyFields deliberately excludes scripts and ordinary package
// metadata. Only dependency topology/metadata that can affect npm's lockfile is
// part of this static completeness gate.
var nodeDependencyFields = []string{
	"dependencies",
	"devDependencies",
	"optionalDependencies",
	"peerDependencies",
	"peerDependenciesMeta",
	"overrides",
	"bundledDependencies",
	"bundleDependencies",
}

type protectedNodeDependencySnapshot map[string]map[string]any

func snapshotProtectedNodeDependencyState(root string) (protectedNodeDependencySnapshot, error) {
	snapshot := make(protectedNodeDependencySnapshot, len(protectedNodePackages))
	for _, pkg := range protectedNodePackages {
		state, err := readNodeDependencyState(filepath.Join(root, filepath.FromSlash(pkg.Manifest)))
		if err != nil {
			return nil, fmt.Errorf("read dependency manifest %s: %w", pkg.Manifest, err)
		}
		snapshot[pkg.Manifest] = state
	}
	return snapshot, nil
}

func validateProtectedNodeDependencyLockstep(before protectedNodeDependencySnapshot, candidateRoot string, current *domain.ExecutionPlan) error {
	retained := retainedCandidatePatchPaths(current)
	for _, pkg := range protectedNodePackages {
		after, err := readNodeDependencyState(filepath.Join(candidateRoot, filepath.FromSlash(pkg.Manifest)))
		if err != nil {
			return fmt.Errorf("read candidate dependency manifest %s: %w", pkg.Manifest, err)
		}
		if reflect.DeepEqual(before[pkg.Manifest], after) {
			continue
		}
		if !retained[pkg.Lockfile] {
			return fmt.Errorf("candidate changes dependency maps in %s but does not retain %s; include the synchronized lockfile in the candidate patch", pkg.Manifest, pkg.Lockfile)
		}
		if _, err := os.Stat(filepath.Join(candidateRoot, filepath.FromSlash(pkg.Lockfile))); err != nil {
			if os.IsNotExist(err) {
				return fmt.Errorf("candidate changes dependency maps in %s but removes %s; retain a synchronized lockfile", pkg.Manifest, pkg.Lockfile)
			}
			return fmt.Errorf("inspect candidate lockfile %s: %w", pkg.Lockfile, err)
		}
	}
	return nil
}

func retainedCandidatePatchPaths(current *domain.ExecutionPlan) map[string]bool {
	paths := map[string]bool{}
	add := func(plan *domain.ExecutionPlan) {
		for _, path := range actualPatchFiles(plan) {
			clean := filepath.ToSlash(filepath.Clean(strings.TrimSpace(path)))
			clean = strings.TrimPrefix(clean, "./")
			if clean != "." && clean != "" {
				paths[clean] = true
			}
		}
	}
	add(current)
	return paths
}

func readNodeDependencyState(path string) (map[string]any, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return map[string]any{}, nil
		}
		return nil, err
	}
	var manifest map[string]json.RawMessage
	if err := json.Unmarshal(raw, &manifest); err != nil {
		return nil, err
	}
	state := make(map[string]any, len(nodeDependencyFields))
	for _, key := range nodeDependencyFields {
		value, ok := manifest[key]
		if !ok {
			continue
		}
		var decoded any
		if err := json.Unmarshal(value, &decoded); err != nil {
			return nil, fmt.Errorf("decode %s: %w", key, err)
		}
		state[key] = decoded
	}
	return state, nil
}
