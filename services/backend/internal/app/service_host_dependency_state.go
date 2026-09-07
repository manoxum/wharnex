package app

import (
	"errors"
	"strings"
)

var errHostDependencyState = errors.New("host dependency state prevents verification")

// isHostDependencyStateDiagnostic recognizes a deliberately narrow class of
// host-only Node dependency failures. These diagnostics occur after the same
// candidate has already passed the Protected verification command, so another
// source patch cannot install the missing platform-specific host dependency.
func isHostDependencyStateDiagnostic(detail string) bool {
	normalized := strings.ToLower(detail)
	if strings.Contains(normalized, "host_dependency_state") {
		return true
	}
	for _, marker := range []string{
		"cannot find native binding",
		"npm has a bug related to optional dependencies",
		"cannot find module '@rolldown/binding-",
		`cannot find module "@rolldown/binding-`,
		"cannot find module './rolldown-binding.",
		`cannot find module "./rolldown-binding.`,
	} {
		if strings.Contains(normalized, marker) {
			return true
		}
	}
	return strings.Contains(normalized, "node_modules/") &&
		strings.Contains(normalized, "cannot find module") &&
		strings.Contains(normalized, "binding")
}

func wrapHostDependencyState(cause error, diagnostic string) error {
	if cause == nil || !isHostDependencyStateDiagnostic(diagnostic) {
		return cause
	}
	return errors.Join(errHostDependencyState, cause)
}
