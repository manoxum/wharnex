package contextbundle

import (
	"path"
	"strings"

	"kernl.local/harness/backend/internal/projectconfig"
)

func contextExclusion(rel string, isDir bool, legacyPatterns []string, cfg projectconfig.ContextConfig) (reason, rule string, ignored bool) {
	clean := strings.TrimPrefix(filepathSlash(rel), "./")
	if clean == ".wharnex/knowledge" || strings.HasPrefix(clean, ".wharnex/knowledge/") {
		return "Wharnex project knowledge is transported separately", "project-knowledge", true
	}
	if ShouldIgnore(rel, isDir) {
		return "mandatory security/context exclusion", "mandatory", true
	}
	if matchesIgnorePatterns(rel, legacyPatterns) {
		return "matched .harnessignore", "harnessignore", true
	}
	if matchAny(rel, cfg.Exclude) {
		return "project config exclude", "config-exclude", true
	}
	if !isDir && len(cfg.Include) > 0 && !matchAny(rel, cfg.Include) {
		return "not selected by project config include", "config-include", true
	}
	if cfg.AutoExclude && !explicitIncludeKeeps(rel, isDir, cfg.Include) {
		if reason, ignored := autoExclude(rel, isDir); ignored {
			return reason, "auto-exclude", true
		}
	}
	return "", "", false
}

func matchesIgnorePatterns(rel string, patterns []string) bool {
	if len(patterns) == 0 {
		return false
	}
	rel = strings.TrimPrefix(filepathSlash(rel), "./")
	base := path.Base(rel)
	for _, pattern := range patterns {
		pattern = strings.TrimSuffix(strings.TrimPrefix(filepathSlash(strings.TrimSpace(pattern)), "./"), "/")
		if pattern == "" {
			continue
		}
		if matched, _ := path.Match(pattern, rel); matched {
			return true
		}
		if matched, _ := path.Match(pattern, base); matched {
			return true
		}
		if rel == pattern || strings.HasPrefix(rel, pattern+"/") {
			return true
		}
	}
	return false
}

func explicitIncludeKeeps(rel string, isDir bool, patterns []string) bool {
	if len(patterns) == 0 {
		return false
	}
	if matchAny(rel, patterns) {
		return true
	}
	if !isDir {
		return false
	}
	rel = strings.TrimSuffix(strings.TrimPrefix(filepathSlash(rel), "./"), "/")
	for _, pattern := range patterns {
		pattern = strings.TrimPrefix(filepathSlash(strings.TrimSpace(pattern)), "./")
		if strings.HasPrefix(pattern, rel+"/") {
			return true
		}
	}
	return false
}

func autoExclude(rel string, isDir bool) (string, bool) {
	rel = strings.TrimPrefix(filepathSlash(rel), "./")
	parts := strings.Split(strings.ToLower(rel), "/")
	base := parts[len(parts)-1]
	if isDir {
		if reason := automaticDirectoryReasons[base]; reason != "" {
			return reason, true
		}
		return "", false
	}
	if stringIn(base, automaticMetadataNames) {
		return "os metadata", true
	}
	for _, suffix := range automaticGeneratedSuffixes {
		if strings.HasSuffix(base, suffix) {
			return "generated or binary artifact", true
		}
	}
	for _, suffix := range automaticAssetSuffixes {
		if strings.HasSuffix(base, suffix) {
			return "non-source asset", true
		}
	}
	return "", false
}

var automaticDirectoryReasons = map[string]string{
	".svn": "vcs metadata", ".hg": "vcs metadata", ".idea": "ide metadata", ".vscode": "ide metadata",
	"__pycache__": "language cache", ".pytest_cache": "test cache", ".mypy_cache": "language cache", ".ruff_cache": "language cache",
	".venv": "dependency environment", "venv": "dependency environment", "target": "generated build output", "out": "generated build output",
	".gradle": "build cache", ".dart_tool": "dependency cache", ".terraform": "dependency cache", ".serverless": "generated deployment output",
	"pods": "dependency cache", "playwright-report": "test output", "test-results": "test output", ".cache": "tool cache",
	".parcel-cache": "tool cache", "tmp": "temporary output", "temp": "temporary output",
}

var automaticMetadataNames = []string{".ds_store", "thumbs.db", "desktop.ini"}
var automaticGeneratedSuffixes = []string{".log", ".tmp", ".temp", ".swp", ".swo", ".orig", ".rej", "~", ".pyc", ".pyo", ".class", ".o", ".obj", ".a", ".so", ".dylib", ".dll", ".exe", ".bin", ".tsbuildinfo"}

// Archive extensions are not repeated here: they are mandatorily blocked in
// ShouldIgnore (builder.go) and must never depend on auto_exclude/include.
var automaticAssetSuffixes = []string{".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".mp3", ".mp4", ".mov", ".avi", ".woff", ".woff2", ".ttf", ".otf"}

func matchAny(rel string, patterns []string) bool {
	rel = strings.TrimPrefix(filepathSlash(rel), "./")
	for _, pattern := range patterns {
		if matchConfiguredPattern(rel, pattern) {
			return true
		}
	}
	return false
}

func matchConfiguredPattern(rel, pattern string) bool {
	pattern = strings.TrimPrefix(filepathSlash(strings.TrimSpace(pattern)), "./")
	pattern = strings.TrimSuffix(pattern, "/")
	if pattern == "" {
		return false
	}
	if !strings.Contains(pattern, "/") {
		matched, _ := path.Match(pattern, path.Base(rel))
		return matched || rel == pattern || strings.HasPrefix(rel, pattern+"/")
	}
	return matchSegments(strings.Split(pattern, "/"), strings.Split(rel, "/"))
}

func matchSegments(pattern, value []string) bool {
	if len(pattern) == 0 {
		return len(value) == 0
	}
	if pattern[0] == "**" {
		if matchSegments(pattern[1:], value) {
			return true
		}
		return len(value) > 0 && matchSegments(pattern, value[1:])
	}
	if len(value) == 0 {
		return false
	}
	matched, err := path.Match(pattern[0], value[0])
	return err == nil && matched && matchSegments(pattern[1:], value[1:])
}

func filepathSlash(value string) string {
	return strings.ReplaceAll(value, "\\", "/")
}
