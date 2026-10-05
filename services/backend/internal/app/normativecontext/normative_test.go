package normativecontext

import (
	"reflect"
	"testing"
)

func TestSelectSeedsOnlyPrimaryNormativeDocuments(t *testing.T) {
	entries := []Entry{
		{Name: "context/AGENTS.md", Size: 10},
		{Name: "context/SoT/ARCHITECTURE.md", Size: 10},
		{Name: "context/SoT/nested/RULES.md", Size: 10},
		{Name: "context/SoT/diagram.png", Size: 10},
		{Name: "context/SECURITY.md", Size: 10},
		{Name: "context/services/api/AGENTS.md", Size: 10},
		{Name: "context/README.md", Size: 10},
		{Name: "context/adr/ADR-0001.md", Size: 10},
		{Name: "context/docs/SECURITY.md", Size: 10},
		{Name: "ref-context/other/AGENTS.md", Size: 10},
		{Name: "metadata/context-sources.json", Size: 10},
	}
	got := Select(entries, "context/")
	want := []string{
		"context/AGENTS.md",
		"context/SECURITY.md",
		"context/SoT/ARCHITECTURE.md",
		"context/SoT/nested/RULES.md",
		"context/services/api/AGENTS.md",
	}
	if !reflect.DeepEqual(got.Paths, want) || got.Bytes != 50 || len(got.Omitted) != 0 {
		t.Fatalf("selection = %#v", got)
	}
}

func TestSelectKeepsAuthorityOrderWithinTheByteBound(t *testing.T) {
	entries := []Entry{
		{Name: "context/services/AGENTS.md", Size: 1},
		{Name: "context/SoT/HUGE.md", Size: MaxBytes},
		{Name: "context/AGENTS.md", Size: 2},
	}
	got := Select(entries, "context/")
	if !reflect.DeepEqual(got.Paths, []string{"context/AGENTS.md", "context/services/AGENTS.md"}) {
		t.Fatalf("paths = %#v", got.Paths)
	}
	if !reflect.DeepEqual(got.Omitted, []string{"context/SoT/HUGE.md"}) || got.Bytes != 3 {
		t.Fatalf("selection = %#v", got)
	}
}

func TestSelectWithoutNormativeDocumentsSeedsNothing(t *testing.T) {
	got := Select([]Entry{{Name: "context/main.go", Size: 5}}, "context/")
	if got.Paths != nil || got.Bytes != 0 {
		t.Fatalf("selection = %#v", got)
	}
}
