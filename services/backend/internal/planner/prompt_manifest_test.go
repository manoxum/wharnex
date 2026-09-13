package planner

import (
	"fmt"
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/domain"
)

func manifestWithFiles(count int) domain.ContextManifest {
	files := make([]domain.ContextFile, 0, count)
	for index := 0; index < count; index++ {
		files = append(files, domain.ContextFile{
			Path:   fmt.Sprintf("services/app/.pnpm-store/v11/files/%02d/%064d", index%64, index),
			Size:   4717,
			SHA256: fmt.Sprintf("%064d", index),
		})
	}
	return domain.ContextManifest{ID: "ctx", ProjectRoot: "/p", SHA256: strings.Repeat("a", 64), Files: files}
}

// A small project's manifest is carried whole and unannotated.
func TestSmallManifestIsCarriedComplete(t *testing.T) {
	rendered := renderContextManifest(manifestWithFiles(40))
	if strings.Contains(rendered, "TRUNCATED") {
		t.Fatal("a manifest that fits must not be annotated as truncated")
	}
	if !strings.Contains(rendered, "files/39/") {
		t.Fatal("every file must be listed when the inventory fits")
	}
}

// The production shape: 14,468 files produced a 5.8 MiB prompt against a 1 MiB
// transport limit, so no prompt in that project could be delivered at all.
func TestOversizedManifestIsBoundedAndDeclaresTruncation(t *testing.T) {
	rendered := renderContextManifest(manifestWithFiles(14468))
	if len(rendered) > manifestPromptBudget {
		t.Fatalf("rendered manifest = %d bytes, over the %d budget", len(rendered), manifestPromptBudget)
	}
	if !strings.Contains(rendered, "TRUNCATED") {
		t.Fatal("a truncated inventory must say so")
	}
	if !strings.Contains(rendered, "of 14468 files") {
		t.Fatalf("the note must state the real total:\n%s", rendered[max(0, len(rendered)-400):])
	}
	// Silent truncation would invite the planner to conclude a file does not
	// exist and write it again; the note must forbid exactly that reading.
	if !strings.Contains(rendered, "NOT evidence that a file does not exist") {
		t.Fatal("the note must say absence from the list is not absence from the project")
	}
	if !strings.Contains(rendered, strings.Repeat("a", 64)) {
		t.Fatal("the authoritative manifest identity must survive truncation")
	}
}

// The whole prompt has to fit the transport, not just the manifest.
func TestBudgetLeavesRoomForTheRestOfThePrompt(t *testing.T) {
	const transportLimit = 1024 * 1024
	if manifestPromptBudget >= transportLimit {
		t.Fatalf("manifest budget %d must stay well under the %d transport limit", manifestPromptBudget, transportLimit)
	}
	if transportLimit-manifestPromptBudget < 512*1024 {
		t.Fatal("the budget must leave at least half the transport limit for instructions, message and knowledge")
	}
}

// Rendering must be deterministic: the same project must not produce a
// different prompt on every request.
func TestTruncationIsDeterministic(t *testing.T) {
	manifest := manifestWithFiles(5000)
	if renderContextManifest(manifest) != renderContextManifest(manifest) {
		t.Fatal("the same manifest must render identically")
	}
}

// Truncation keeps the manifest's own ordering for the entries that survive, so
// the prompt reads like a manifest rather than a re-sorted list.
func TestTruncationPreservesManifestOrdering(t *testing.T) {
	manifest := manifestWithFiles(5000)
	rendered := renderContextManifest(manifest)
	previous := -1
	for index := 0; index < 5000; index++ {
		needle := fmt.Sprintf("%064d", index)
		at := strings.Index(rendered, needle)
		if at < 0 {
			continue
		}
		if at < previous {
			t.Fatal("surviving entries must keep the manifest's original order")
		}
		previous = at
	}
}
