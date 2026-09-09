package app

import (
	"os"
	"path/filepath"
	"strings"
)

// detectedWharnexInstance recognizes another checkout structurally, then reads
// only its non-secret, local instance label. It never treats project contents
// as authority for execution mode.
func detectedWharnexInstance(root string) string {
	if _, err := os.Stat(filepath.Join(root, "services", "backend", "go.mod")); err != nil {
		return ""
	}
	if _, err := os.Stat(filepath.Join(root, "services", "desktop", "package.json")); err != nil {
		return ""
	}
	data, err := os.ReadFile(filepath.Join(root, ".harness", "env"))
	if err != nil {
		return "Wharnex"
	}
	for _, line := range strings.Split(string(data), "\n") {
		if value, ok := strings.CutPrefix(strings.TrimSpace(line), "WHARNESS_INSTANCE_ID="); ok {
			return strings.Trim(strings.TrimSpace(value), "'\"")
		}
	}
	return "Wharnex"
}

func statableSelfOpenForbidden(instanceID string, selfEvolution bool) bool {
	return selfEvolution && strings.EqualFold(strings.TrimSpace(instanceID), "statable")
}
