package selfevolution

import "strings"

func activationImpacts(patches []string) []string {
	impacts := map[string]struct{}{}
	for _, patch := range patches {
		for _, path := range patchPaths(patch) {
			if terminalActivationPath(path) {
				impacts["terminal"] = struct{}{}
			}
			switch {
			case strings.HasPrefix(path, "services/backend/"), strings.HasPrefix(path, "schemas/"):
				impacts["backend"] = struct{}{}
			case strings.HasPrefix(path, "services/frontend/"):
				impacts["frontend"] = struct{}{}
			case strings.HasPrefix(path, "services/webapp/"):
				impacts["webapp"] = struct{}{}
			case strings.HasPrefix(path, "services/gateway/"):
				impacts["gateway"] = struct{}{}
			case strings.HasPrefix(path, "services/desktop/"):
				impacts["desktop"] = struct{}{}
			case strings.HasPrefix(path, "services/tunnel/"):
				impacts["tunnel"] = struct{}{}
			case path == "compose.yml", strings.HasPrefix(path, "docker/"):
				impacts["backend"] = struct{}{}
				impacts["frontend"] = struct{}{}
				impacts["webapp"] = struct{}{}
				impacts["gateway"] = struct{}{}
				impacts["tunnel"] = struct{}{}
			}
		}
	}
	return uniqueSorted(impacts)
}

func terminalActivationPath(path string) bool {
	return strings.HasPrefix(path, "services/backend/cmd/terminald/") ||
		strings.HasPrefix(path, "services/backend/internal/sandbox/hostpty_") ||
		path == "services/backend/internal/sandbox/terminal.go" ||
		path == "services/backend/internal/sandbox/terminal_bash_init.go" ||
		path == "services/backend/internal/sandbox/terminal_zsh_init.go" ||
		path == "services/backend/internal/sandbox/terminal_history.go"
}

func mergeActivationImpacts(groups ...[]string) []string {
	merged := map[string]struct{}{}
	for _, group := range groups {
		for _, impact := range group {
			merged[impact] = struct{}{}
		}
	}
	return uniqueSorted(merged)
}
