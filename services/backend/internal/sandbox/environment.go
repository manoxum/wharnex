package sandbox

import (
	"os"
	"strings"

	"kernl.local/harness/backend/internal/domain"
)

func commandEnvironment(command domain.CommandSpec) []string {
	if command.EnvAllowlist == nil {
		return append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	}
	env := []string{"GIT_TERMINAL_PROMPT=0"}
	seen := map[string]bool{"GIT_TERMINAL_PROMPT": true}
	if path, ok := os.LookupEnv("PATH"); ok {
		env = append(env, "PATH="+path)
		seen["PATH"] = true
	}
	for _, raw := range command.EnvAllowlist {
		name := strings.TrimSpace(raw)
		if name == "" || seen[name] {
			continue
		}
		if value, ok := os.LookupEnv(name); ok {
			env = append(env, name+"="+value)
		}
		seen[name] = true
	}
	return env
}
