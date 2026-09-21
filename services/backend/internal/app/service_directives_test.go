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
	if !strings.Contains(both, "ref-context/") {
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

// @see has no filesystem location to check against, so the legend explains
// what it means without a manifest-backed "missing" claim it cannot make.
func TestDirectiveLegendExplainsSee(t *testing.T) {
	legend := directiveLegend("compare @{[see]before.png} with the spec", manifestWith("a.ts"))
	if !strings.Contains(legend, "@{[see]") {
		t.Fatalf("legend must describe the @see marker it saw: %q", legend)
	}
	if !strings.Contains(legend, "direct upload \"before.png\"") {
		t.Fatalf("legend must explain @see points at a direct attachment: %q", legend)
	}
}

func TestDirectiveLegendExplainsChatAndLibraryFiles(t *testing.T) {
	legend := directiveLegend("compare @{[chat]diagram.png} with @{[lib]session|ses_123|artifact_456}", manifestWith("a.ts"))
	if !strings.Contains(legend, "file already stored in this chat") || !strings.Contains(legend, "Wharnex library") {
		t.Fatalf("legend must explain chat and library transports: %q", legend)
	}
}

func TestDirectiveLegendExplainsTodoAnalysisTransport(t *testing.T) {
	legend := directiveLegend("implement @{[todo]todo_1}", manifestWith("a.ts"))
	for _, want := range []string{"@{[todo]", "Worker classification, context and pre-plan", "Markdown pre-analysis", "stored artifacts"} {
		if !strings.Contains(legend, want) {
			t.Fatalf("legend must explain @todo transport %q: %q", want, legend)
		}
	}
}

func TestDirectiveLegendResolvesQualifiedSeeToExactBundlePath(t *testing.T) {
	context := domain.ContextBundle{
		Manifest:        manifestWith("src/App.tsx"),
		RelatedProjects: []domain.RelatedProjectContext{{Name: "core", Prefix: "RELATED_PROJECTS/01-core/", Manifest: manifestWith("api/auth.go")}},
		Attachments:     []domain.AttachedPathContext{{Root: "/srv/contracts", Prefix: "ATTACHMENTS/01-contracts/", IncludedPaths: []string{"openapi/api.yml"}}},
	}
	legend := directiveLegendWithContext("focus @{[see]file|src/App.tsx} @{[see]ref|core|api/auth.go} @{[see]attach|/srv/contracts|openapi/api.yml} @{[see]chat|artifact|artifact_1} @{[see]lib|session|ses_1|artifact_2}", context)
	for _, path := range []string{"src/App.tsx", "ref-context/01-core/api/auth.go", "att-context/attach-01/openapi/api.yml", "@{[chat]artifact|artifact_1}", "@{[lib]session|ses_1|artifact_2}"} {
		if !strings.Contains(legend, path) {
			t.Fatalf("legend must resolve %q: %s", path, legend)
		}
	}
}

func TestDirectiveLegendResolvesSeeDirectoriesFromVisibleDescendants(t *testing.T) {
	context := domain.ContextBundle{
		Manifest:        manifestWith("src/ui/App.tsx"),
		RelatedProjects: []domain.RelatedProjectContext{{Name: "core", Prefix: "RELATED_PROJECTS/01-core/", Manifest: manifestWith("api/auth/handler.go")}},
		Attachments:     []domain.AttachedPathContext{{Root: "/srv/contracts", Prefix: "ATTACHMENTS/01-contracts/", IncludedPaths: []string{"openapi/v1/api.yml"}}},
	}
	legend := directiveLegendWithContext("focus @{[see]file|src} @{[see]ref|core|api/auth} @{[see]attach|/srv/contracts|openapi}", context)
	for _, path := range []string{"src/", "ref-context/01-core/api/auth/", "att-context/attach-01/openapi/"} {
		if !strings.Contains(legend, path) {
			t.Fatalf("legend must resolve directory %q: %s", path, legend)
		}
	}
	if strings.Count(legend, "prioritize this directory") != 3 {
		t.Fatalf("legend must classify each resolved directory: %s", legend)
	}
}

func TestMissingContextFilesTreatsVisibleDirectoriesAsPresent(t *testing.T) {
	missing := missingContextFiles([]string{"src", "src/ui/App.tsx", "generated"}, manifestWith("src/ui/App.tsx"))
	if len(missing) != 1 || missing[0] != "generated" {
		t.Fatalf("missing=%#v", missing)
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
