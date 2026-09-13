package projectversion

import (
	"os"
	"path/filepath"
	"testing"
)

func TestEnsureCreatesFourPartVersion(t *testing.T) {
	root := t.TempDir()
	version, created, err := Ensure(root)
	if err != nil {
		t.Fatal(err)
	}
	if !created || version != InitialVersion {
		t.Fatalf("created=%v version=%q", created, version)
	}
}

func TestBumpAppliesOrderedComponents(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, FileName), []byte("v1.2.46.13\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	before, after, err := Bump(root, []Increment{{Component: "patch", Amount: 2}, {Component: "minor", Amount: 1}})
	if err != nil {
		t.Fatal(err)
	}
	if before != "v1.2.46.13" || after != "v1.2.47.0" {
		t.Fatalf("before=%q after=%q", before, after)
	}
}

func TestBumpNormalizesLegacyThreePartVersion(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, FileName), []byte("1.4.9\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	_, after, err := Bump(root, []Increment{{Component: "patch", Amount: 1}})
	if err != nil {
		t.Fatal(err)
	}
	if after != "v1.4.9.1" {
		t.Fatalf("after=%q", after)
	}
}

func TestRestoreUsesCompareAndSwap(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, FileName), []byte("v2.0.0.0\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := Restore(root, "v2.0.0.0", "v1.9.0.0"); err != nil {
		t.Fatal(err)
	}
	if err := Restore(root, "v2.0.0.0", "v1.8.0.0"); err == nil {
		t.Fatal("expected compare-and-swap failure")
	}
}

func TestBumpRejectsOversizedIncrement(t *testing.T) {
	root := t.TempDir()
	if _, _, err := Bump(root, []Increment{{Component: "patch", Amount: 1001}}); err == nil {
		t.Fatal("expected oversized increment rejection")
	}
}
