package patchdiff_test

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/protocol"
)

func TestRawDocumentDiffMatchesGitApply(t *testing.T) {
	fence := strings.Repeat("`", 3)
	project := t.TempDir()
	if err := os.WriteFile(filepath.Join(project, "README.md"), []byte(fence+"go\nold\n"+fence+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	patch := "--- a/README.md\n+++ b/README.md\n@@ -1,3 +1,3 @@\n " + fence + "go\n-old\n+new\n " + fence + "\n"
	command := exec.Command("git", "apply", "--check", "-")
	command.Dir, command.Stdin = project, strings.NewReader(patch)
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("fixture must be a valid Git diff: %v %s", err, output)
	}
	if err := protocol.ValidatePatch(patch); err != nil {
		t.Fatalf("Git-accepted document diff must pass Wharnex preflight: %v", err)
	}
}

func TestValidatePatchPreservesMarkdownFenceContent(t *testing.T) {
	marker := strings.Repeat("`", 3)
	for _, prefix := range []string{"+", "-", " "} {
		t.Run(prefix, func(t *testing.T) {
			rangeHeader := map[string]string{"+": "@@ -0,0 +1,3 @@", "-": "@@ -1,3 +0,0 @@", " ": "@@ -1,3 +1,3 @@"}[prefix]
			patch := "--- a/README.md\n+++ b/README.md\n" + rangeHeader + "\n" +
				prefix + marker + "go\n" + prefix + "example\n" + prefix + marker + "\n"
			if err := protocol.ValidatePatch(patch); err != nil {
				t.Fatalf("raw unified diff containing fenced document content rejected: %v", err)
			}
		})
	}
}

func TestValidatePatchRejectsMarkdownFenceEnvelope(t *testing.T) {
	patch := "--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-old\n+new\n"
	for _, marker := range []string{strings.Repeat("`", 3), "~~~"} {
		for _, wrapped := range []string{marker + "diff\n" + patch + marker + "\n", patch + marker + "\n"} {
			if err := protocol.ValidatePatch(wrapped); err == nil {
				t.Fatal("Markdown envelope around raw diff must remain rejected")
			}
		}
	}
}
