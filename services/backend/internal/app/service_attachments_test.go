package app

import (
	"path/filepath"
	"reflect"
	"testing"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/projectconfig"
)

func TestReferenceSelectionsPromotePrimaryFileAndDirectoryWithoutPersistingConfig(t *testing.T) {
	root := t.TempDir()
	cfg := projectconfig.Default(root)
	if err := projectconfig.Save(root, cfg); err != nil {
		t.Fatal(err)
	}

	item := domain.Session{ProjectPath: root}
	got := (&Service{}).referenceSelections(item, "read @{[file]out/generated.txt} and @{[file]vendor/sdk} then focus @{[see]file|docs}")
	selection, ok := got[root]
	if !ok {
		t.Fatalf("primary project selection missing: %#v", got)
	}
	want := []string{"out/generated.txt", "out/generated.txt/**", "vendor/sdk", "vendor/sdk/**", "docs", "docs/**"}
	if !reflect.DeepEqual(selection.IncludeOverride, want) {
		t.Fatalf("include overrides=%#v want %#v", selection.IncludeOverride, want)
	}

	persisted, err := projectconfig.Load(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(persisted.Context.IncludeOverride) != 0 {
		t.Fatalf("request-local selection leaked into %s: %#v", filepath.Join(root, projectconfig.FileName), persisted.Context.IncludeOverride)
	}
}
