package projectconfig

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestEnsureCreatesWhanessConfigAndRoundTrips(t *testing.T) {
	root := t.TempDir()
	cfg, created, err := Ensure(root)
	if err != nil {
		t.Fatal(err)
	}
	if !created || !cfg.Context.AutoExclude {
		t.Fatalf("unexpected config: created=%v cfg=%+v", created, cfg)
	}
	if _, err := os.Stat(filepath.Join(root, FileName)); err != nil {
		t.Fatalf("%s not created: %v", FileName, err)
	}
	cfg.Context.Include = []string{"src/**", "go.mod"}
	cfg.Context.IncludeOverride = []string{"generated/important.ts"}
	cfg.Context.Exclude = []string{"fixtures/**", "*.generated.ts"}
	cfg.Context.MaxFileBytes = 4 * 1024 * 1024
	if err := Save(root, cfg); err != nil {
		t.Fatal(err)
	}
	loaded, err := Load(root)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(cfg, loaded) {
		t.Fatalf("round trip mismatch:\nwant %#v\n got %#v", cfg, loaded)
	}
}

func TestValidateRejectsTraversalPattern(t *testing.T) {
	cfg := Default(t.TempDir())
	cfg.Context.Exclude = []string{"../outside"}
	if err := Validate(&cfg); err == nil {
		t.Fatal("expected traversal pattern rejection")
	}
}
