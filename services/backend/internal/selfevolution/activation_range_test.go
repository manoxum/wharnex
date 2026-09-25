package selfevolution

import (
	"path/filepath"
	"strings"
	"testing"
)

// A plan that touched only the Desktop, applied while an engine fix sat in the
// operator's uncommitted work: the pre-merge snapshot committed the fix, the
// host build built it, and activation must recreate the backend too.
func TestWidenActivationImpactsCoversEverythingTheHostChanged(t *testing.T) {
	root := fakeGitRoot(t)
	mustWrite(t, filepath.Join(root, "services", "desktop", "main.mjs"), "old\n", 0o644)
	mustGitCommand(t, root, "add", "-A")
	mustGitCommand(t, root, "-c", "user.name=T", "-c", "user.email=t@example.invalid", "commit", "-qm", "desktop")
	manager := New(root)
	tx, err := manager.Prepare("ses-desktop", "plan-desktop", []string{"--- a/services/desktop/main.mjs\n+++ b/services/desktop/main.mjs\n@@ -1 +1 @@\n-old\n+new\n"})
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Release()
	if strings.Join(tx.ActivationImpacts, ",") != "desktop" {
		t.Fatalf("patch impacts = %#v", tx.ActivationImpacts)
	}

	mustWrite(t, filepath.Join(root, "services", "backend", "engine.go"), "package engine\n", 0o644)
	mustWrite(t, filepath.Join(root, "services", "desktop", "main.mjs"), "new\n", 0o644)
	mustGitCommand(t, root, "add", "-A")
	mustGitCommand(t, root, "-c", "user.name=T", "-c", "user.email=t@example.invalid", "commit", "-qm", "Wharnex host snapshot before integration")

	widened, err := manager.WidenActivationImpacts(tx)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(widened.ActivationImpacts, ",") != "backend,desktop" {
		t.Fatalf("widened impacts = %#v, want backend,desktop", widened.ActivationImpacts)
	}
	metadata, err := widened.readMetadata()
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(metadata.ActivationImpacts, ",") != "backend,desktop" {
		t.Fatalf("persisted impacts = %#v: a restarted supervisor reads these", metadata.ActivationImpacts)
	}
}
