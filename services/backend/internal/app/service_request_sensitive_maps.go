package app

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"unicode/utf8"
)

const (
	requestSensitiveMapProtocol       = "harness.sensitive-file-map/v1"
	maxSensitiveMapSourceBytes  int64 = 1 << 20
	maxSensitiveMapVariables          = 2048
)

var envAssignmentKey = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]{0,127}$`)

func requestSensitiveFileMap(source requestContextMapSource) string {
	var output strings.Builder
	fmt.Fprintf(&output, "# %s\n", requestSensitiveMapProtocol)
	output.WriteString("# Values are never exported. <<configured>> means a non-empty assignment exists; <<empty>> means the assignment exists with an empty value.\n")
	found := false
	for _, excluded := range source.manifest.Excluded {
		relative, _ := splitContextExclusion(excluded)
		if !sensitiveEnvPath(relative) {
			continue
		}
		keys, ok := redactedEnvKeys(source.root, relative)
		if !ok {
			continue
		}
		found = true
		fmt.Fprintf(&output, "\n# file: %s\n", relative)
		if len(keys) == 0 {
			output.WriteString("# no assignment keys detected\n")
			continue
		}
		for _, key := range keys {
			fmt.Fprintf(&output, "%s=%s\n", key.name, key.state)
		}
	}
	if !found {
		output.WriteString("\n# no excluded .env-style file was available for redacted key mapping\n")
	}
	return output.String()
}

type redactedEnvKey struct {
	name  string
	state string
}

func sensitiveEnvPath(relative string) bool {
	clean := filepath.ToSlash(strings.TrimSpace(relative))
	if clean == "" || strings.HasPrefix(clean, "/") || strings.HasPrefix(clean, "../") {
		return false
	}
	base := strings.ToLower(filepath.Base(clean))
	return base == ".env" || strings.HasPrefix(base, ".env.") || strings.HasSuffix(base, ".env")
}

func redactedEnvKeys(root, relative string) ([]redactedEnvKey, bool) {
	path, ok := contextMapHostPath(root, relative)
	if !ok {
		return nil, false
	}
	info, err := os.Lstat(path)
	if err != nil || info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() || info.Size() < 0 || info.Size() > maxSensitiveMapSourceBytes {
		return nil, false
	}
	raw, err := os.ReadFile(path)
	if err != nil || !utf8.Valid(raw) || strings.ContainsRune(string(raw), '\x00') {
		return nil, false
	}
	keys := make([]redactedEnvKey, 0)
	seen := make(map[string]struct{})
	for _, line := range strings.Split(string(raw), "\n") {
		line = strings.TrimSpace(strings.TrimPrefix(line, "\ufeff"))
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		line = strings.TrimSpace(strings.TrimPrefix(line, "export "))
		index := strings.IndexByte(line, '=')
		if index <= 0 {
			continue
		}
		key := strings.TrimSpace(line[:index])
		if !envAssignmentKey.MatchString(key) {
			continue
		}
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		value := strings.TrimSpace(line[index+1:])
		state := "<<configured>>"
		if value == "" || value == `""` || value == `''` {
			state = "<<empty>>"
		}
		keys = append(keys, redactedEnvKey{name: key, state: state})
		if len(keys) >= maxSensitiveMapVariables {
			break
		}
	}
	return keys, true
}
