package protocol

import (
	"errors"
	"fmt"
	"kernl.local/harness/backend/internal/projectknowledge"
	"path/filepath"
	"strings"
)

func ValidatePatchPaths(patch string) error {
	if len(patch) > MaxPatchBytes {
		return fmt.Errorf("patch exceeds %d byte limit", MaxPatchBytes)
	}
	for _, line := range strings.Split(patch, "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.Contains(trimmed, "mode 120000") || strings.Contains(trimmed, "mode 160000") {
			return errors.New("symlink/submodule patch modes are denied")
		}
		switch {
		case strings.HasPrefix(line, "+++ "), strings.HasPrefix(line, "--- "):
			path := strings.TrimSpace(line[4:])
			if fields := strings.Fields(path); len(fields) > 0 {
				path = fields[0]
			}
			if err := validatePatchPath(path); err != nil {
				return err
			}
		case strings.HasPrefix(line, "rename from "):
			if err := validatePatchPath(strings.TrimSpace(strings.TrimPrefix(line, "rename from "))); err != nil {
				return err
			}
		case strings.HasPrefix(line, "rename to "):
			if err := validatePatchPath(strings.TrimSpace(strings.TrimPrefix(line, "rename to "))); err != nil {
				return err
			}
		case strings.HasPrefix(line, "copy from "):
			if err := validatePatchPath(strings.TrimSpace(strings.TrimPrefix(line, "copy from "))); err != nil {
				return err
			}
		case strings.HasPrefix(line, "copy to "):
			if err := validatePatchPath(strings.TrimSpace(strings.TrimPrefix(line, "copy to "))); err != nil {
				return err
			}
		case strings.HasPrefix(line, "diff --git "):
			fields := strings.Fields(strings.TrimPrefix(line, "diff --git "))
			if len(fields) != 2 {
				return errors.New("malformed diff --git header")
			}
			for _, field := range fields {
				if err := validatePatchPath(field); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

// IsWharnexManagedPath reports whether a path is Wharnex-owned project state
// that the planner may never patch directly.
//
// Project knowledge is materialized by Wharnex from the `harness.knowledge/v2`
// records at the commit boundary; `catalog.json` is metadata derived from those
// records. A planner patch against this subtree would fight the materializer.
//
// Exported because the same rule has to be consulted where a merge conflict is
// routed: a conflict on one of these paths must be reconciled by Wharnex rather
// than handed to a planner that the validator would then refuse. The two rules
// contradicted each other, which produced a request that could never succeed and
// retried forever.
func IsWharnexManagedPath(value string) bool {
	return projectknowledge.IsManagedPath(value)
}

// validatePathShape enforces the structural rules every path must satisfy,
// regardless of whether it is being written, read, or merely forecast:
// traversal, absoluteness, and diff quoting/escaping.
func validatePathShape(value string) error {
	path := strings.TrimSpace(value)
	if path == "/dev/null" {
		return nil
	}
	if path == "" {
		return errors.New("empty patch path")
	}
	if strings.HasPrefix(path, "\"") || strings.Contains(path, "\\") {
		return fmt.Errorf("quoted/escaped patch paths are denied: %s", path)
	}
	path = strings.TrimPrefix(path, "a/")
	path = strings.TrimPrefix(path, "b/")
	if filepath.IsAbs(path) {
		return fmt.Errorf("absolute patch path denied: %s", path)
	}
	clean := filepath.Clean(path)
	if clean == "." || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return fmt.Errorf("patch path escapes project: %s", path)
	}
	return nil
}

// validatePatchPath is the mutation boundary: path shape plus the denial of
// paths a plan may never write.
func validatePatchPath(value string) error {
	if err := validatePathShape(value); err != nil {
		return err
	}
	path := strings.TrimSpace(value)
	if path == "/dev/null" {
		return nil
	}
	path = strings.TrimPrefix(strings.TrimPrefix(path, "a/"), "b/")
	clean := filepath.Clean(path)
	lower := strings.ToLower(filepath.ToSlash(clean))
	base := filepath.Base(lower)
	safeEnvTemplate := base == ".env.example" || base == ".env.sample" || base == ".env.template"
	blocked := lower == "version" || lower == ".env" || (strings.HasPrefix(base, ".env.") && !safeEnvTemplate) || lower == ".npmrc" || lower == ".netrc" || lower == ".pypirc" || lower == ".git-credentials" || lower == "credentials.json" || strings.HasPrefix(lower, ".git/") || strings.HasPrefix(lower, ".harness/") || IsWharnexManagedPath(lower) || strings.HasPrefix(lower, ".ssh/") || strings.HasPrefix(lower, ".aws/") || strings.Contains(lower, "/secrets/")
	if blocked {
		return fmt.Errorf("sensitive patch path denied: %s", path)
	}
	return nil
}
