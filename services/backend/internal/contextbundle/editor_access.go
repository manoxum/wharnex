package contextbundle

import (
	"path"
	"strings"
)

// ShouldIgnoreEditorPath keeps the normal context boundary for the human Editor,
// except for existing environment files. Environment files remain excluded from
// model context and sandbox copies; this helper only decides whether the trusted
// local Editor may expose a path that already exists on disk.
func ShouldIgnoreEditorPath(rel string, isDir bool, patterns []string) bool {
	clean := strings.TrimPrefix(filepathSlash(rel), "./")
	if !isDir && IsEditorEnvironmentFile(clean) {
		for parent := path.Dir(clean); parent != "." && parent != "/"; parent = path.Dir(parent) {
			if ShouldIgnoreWithPatterns(parent, true, patterns) {
				return true
			}
		}
		return false
	}
	return ShouldIgnoreWithPatterns(clean, isDir, patterns)
}

// IsEditorEnvironmentFile identifies the environment-file naming forms that the
// Editor may expose as a human-only local surface.
func IsEditorEnvironmentFile(rel string) bool {
	name := strings.ToLower(path.Base(filepathSlash(rel)))
	return name == ".env" || strings.HasPrefix(name, ".env.") || strings.HasSuffix(name, ".env")
}
