package app

import (
	"errors"
	"path/filepath"
	"strings"

	"kernl.local/harness/backend/internal/domain"
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

// hostDependencyRemediationSite locates the working directory of the npm/npx
// project whose host-only dependency state failed verification, by scanning
// the same pending host changes ApplyToHost itself verifies. It never
// inspects planner-supplied text: the directory comes only from Wharness's
// own verified plan data.
func hostDependencyRemediationSite(pending []domain.PendingHostChange) (cwd string, ok bool) {
	for index := range pending {
		if site, found := npmCommandSite(pending[index].Plan.Verification); found {
			return site, true
		}
		for _, op := range pending[index].Plan.Operations {
			if op.Type != "command" {
				continue
			}
			if site, found := npmCommandSite([]domain.CommandSpec{op.Command}); found {
				return site, true
			}
		}
	}
	return "", false
}

func npmCommandSite(commands []domain.CommandSpec) (cwd string, ok bool) {
	for _, command := range commands {
		if len(command.Argv) == 0 {
			continue
		}
		switch strings.ToLower(filepath.Base(command.Argv[0])) {
		case "npm", "npx", "node":
			return command.Cwd, true
		}
	}
	return "", false
}

// hostDependencyRemediationCommands is the fixed, hand-reviewed recovery for
// the npm optional-dependency bug (npm/cli#4828): a platform-specific native
// binding (observed with rolldown) silently fails to install, and the only
// known fix is removing both node_modules and the lockfile before a clean
// `npm install` — never `npm ci`, since the lockfile is deliberately gone.
// This is the exact remediation the npm error message itself recommends.
// The set is closed: it is never extended with planner-supplied commands.
func hostDependencyRemediationCommands(cwd string) []domain.CommandSpec {
	return []domain.CommandSpec{
		{Argv: []string{"rm", "-rf", "node_modules"}, Cwd: cwd, TimeoutSeconds: 120, ExpectedExitCodes: []int{0}},
		{Argv: []string{"rm", "-f", "package-lock.json"}, Cwd: cwd, TimeoutSeconds: 30, ExpectedExitCodes: []int{0}},
		{Argv: []string{"npm", "install"}, Cwd: cwd, TimeoutSeconds: 600, Network: true, ExpectedExitCodes: []int{0}},
	}
}
