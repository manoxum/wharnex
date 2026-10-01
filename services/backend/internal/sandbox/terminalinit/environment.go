package terminalinit

import "strings"

// EnvironmentValue returns the first value for key in the shell environment.
func EnvironmentValue(env []string, key string) string {
	prefix := key + "="
	for _, entry := range env {
		if strings.HasPrefix(entry, prefix) {
			return strings.TrimPrefix(entry, prefix)
		}
	}
	return ""
}

// ReplaceEnvironmentValue replaces all previous values for key.
func ReplaceEnvironmentValue(env []string, key, value string) []string {
	prefix := key + "="
	filtered := env[:0]
	for _, entry := range env {
		if !strings.HasPrefix(entry, prefix) {
			filtered = append(filtered, entry)
		}
	}
	return append(filtered, prefix+value)
}
