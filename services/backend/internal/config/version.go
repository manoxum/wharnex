package config

import (
	"os"
	"path/filepath"
	"strings"
)

func readProjectVersion(root string) string {
	root = strings.TrimSpace(root)
	if root == "" {
		return ""
	}
	raw, err := os.ReadFile(filepath.Join(root, "VERSION"))
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(raw))
}
