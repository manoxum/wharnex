package sandbox

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

func TestProtectedRunnerGoMatchesBackendModule(t *testing.T) {
	root := filepath.Join("..", "..", "..", "..")
	module, err := os.ReadFile(filepath.Join(root, "services", "backend", "go.mod"))
	if err != nil {
		t.Fatal(err)
	}
	image, err := os.ReadFile(filepath.Join(root, "docker", "runner", "Dockerfile"))
	if err != nil {
		t.Fatal(err)
	}
	version := regexp.MustCompile(`(?m)^go ([0-9]+\.[0-9]+(?:\.[0-9]+)?)$`).FindStringSubmatch(string(module))
	if len(version) != 2 {
		t.Fatal("backend go.mod has no Go version")
	}
	if !strings.Contains(string(image), "FROM golang:"+version[1]+"-bookworm AS go") {
		t.Fatalf("Protected runner Go base must match backend go.mod version %s", version[1])
	}
}
