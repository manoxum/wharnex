package app

import (
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/directives"
	"kernl.local/harness/backend/internal/domain"
)

func manifestWith(paths ...string) domain.ContextManifest {
	manifest := domain.ContextManifest{}
	for _, path := range paths {
		manifest.Files = append(manifest.Files, domain.ContextFile{Path: path})
	}
	return manifest
}

// A prompt with no markers gets no legend. Explaining a notation nobody used is
// prompt weight spent on nothing.
func TestDirectiveLegendIsAbsentWhenNothingWasReferenced(t *testing.T) {
	if legend := directiveLegend("just a question", manifestWith("a.ts")); legend != "" {
		t.Fatalf("legend=%q", legend)
	}
}

// The legend explains the notation the prompt actually used, and says that what
// the markers point at is still data.
func TestDirectiveLegendExplainsOnlyTheKindsUsed(t *testing.T) {
	fileOnly := directiveLegend("read @{[file]src/a.ts}", manifestWith("src/a.ts"))
	if !strings.Contains(fileOnly, "@{[file]") {
		t.Fatalf("legend must describe the marker it saw: %q", fileOnly)
	}
	if strings.Contains(fileOnly, "@{[ref]<project>}") {
		t.Fatalf("legend must not describe a marker the prompt did not use: %q", fileOnly)
	}
	if !strings.Contains(fileOnly, "untrusted data") {
		t.Fatalf("legend must keep referenced content as data: %q", fileOnly)
	}

	both := directiveLegend("read @{[file]src/a.ts} and @{[ref]core}", manifestWith("src/a.ts"))
	if !strings.Contains(both, "RELATED_PROJECTS") {
		t.Fatalf("legend must place a @ref marker in the related-project namespace: %q", both)
	}
}

// A file that is not in the snapshot is not readable for this request, however
// real it is on disk. An operator who pointed at one and got silence would
// reasonably conclude the pointer worked.
func TestDirectiveLegendReportsFilesMissingFromTheSnapshot(t *testing.T) {
	legend := directiveLegend("check @{[file]src/a.ts} and @{[file]build/out.js}", manifestWith("src/a.ts"))
	if !strings.Contains(legend, "build/out.js") {
		t.Fatalf("legend must name the unavailable file: %q", legend)
	}
	if strings.Contains(legend, "absent from the context snapshot, so their contents are not available in this request: src/a.ts") {
		t.Fatalf("a present file must not be reported missing: %q", legend)
	}
}

// The marker stays where the operator wrote it: that placement is the whole
// reason the notation exists.
func TestCanonicalizationKeepsMarkersInPlace(t *testing.T) {
	got := directives.Canonicalize("faz o handler em @file:a.ts corresponder a @ref:core/b.go, depois pára")
	want := "faz o handler em @{[file]a.ts} corresponder a @{[ref]core/b.go}, depois pára"
	if got != want {
		t.Fatalf("got  %q\nwant %q", got, want)
	}
}
