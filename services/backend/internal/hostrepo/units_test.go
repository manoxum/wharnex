package hostrepo

import (
	"context"
	"testing"
)

func TestInspectUnitsMeasuresTheWholeTree(t *testing.T) {
	requireGit(t)
	root, _ := newRepoWithSubmodule(t, "services/app")

	units, err := InspectUnits(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if !units.HasSubmodules() {
		t.Fatal("a superproject with one submodule must measure as more than one unit")
	}
	superproject := units.Root()
	if !superproject.IsRoot() || superproject.Path != RootUnitPath || !superproject.Integrable() {
		t.Fatalf("unexpected superproject unit: %+v", superproject)
	}
	submodule, found := units.Lookup("services/app")
	if !found {
		t.Fatalf("the submodule was not measured: %+v", units.List)
	}
	if !submodule.Integrable() {
		t.Fatalf("an initialized submodule must be integrable: %+v", submodule)
	}
	if submodule.Depth != 1 || submodule.ParentPath != RootUnitPath {
		t.Fatalf("unexpected nesting: %+v", submodule)
	}
	if submodule.CommitSHA == "" {
		t.Fatal("the unit must carry the gitlink the parent records")
	}
	// A submodule's own Git directory is the parent's .git/modules/<name>, not
	// the parent's .git itself. Measuring them as the same repository would make
	// Wharnex commit the superproject while believing it committed the child.
	if submodule.Topology.GitDir == superproject.Topology.GitDir {
		t.Fatal("the submodule resolved to its parent's Git directory")
	}
}

// A submodule with no checkout is still listed — routing must know the boundary
// exists — but it is never integrable: there is nothing to patch and no
// repository to commit into.
func TestInspectUnitsListsAnUninitializedSubmoduleAsUnintegrable(t *testing.T) {
	requireGit(t)
	origin, _ := newRepoWithSubmodule(t, "services/app")
	clone := t.TempDir()
	git(t, clone, "clone", "-q", "--", origin, "copy")

	units, err := InspectUnits(context.Background(), clone+"/copy")
	if err != nil {
		t.Fatal(err)
	}
	submodule, found := units.Lookup("services/app")
	if !found {
		t.Fatalf("an uninitialized submodule must still be listed: %+v", units.List)
	}
	if submodule.Integrable() || submodule.Initialized {
		t.Fatalf("an uninitialized submodule must not be integrable: %+v", submodule)
	}
	if submodule.Unmeasurable == "" {
		t.Fatal("an unintegrable unit must say why")
	}
}

func TestRouteResolvesTheOwningRepository(t *testing.T) {
	units := Units{List: []Unit{
		{Path: RootUnitPath, Depth: 0, Measured: true},
		{Path: "services/app", Depth: 1, Measured: true, Initialized: true},
		{Path: "services/app/vendor/lib", Depth: 2, Measured: true, Initialized: true},
	}}
	cases := []struct {
		path string
		unit string
		rel  string
	}{
		{"README.md", RootUnitPath, "README.md"},
		// A path that merely shares a prefix is not inside the submodule.
		{"services/apple.txt", RootUnitPath, "services/apple.txt"},
		{"services/app/Dockerfile", "services/app", "Dockerfile"},
		// Longest prefix wins, or a nested submodule's files would be committed
		// into its parent, where the index holds only a pointer.
		{"services/app/vendor/lib/x.go", "services/app/vendor/lib", "x.go"},
		{"services/app", "services/app", "."},
	}
	for _, tc := range cases {
		unit, rel := units.Route(tc.path)
		if unit.Path != tc.unit || rel != tc.rel {
			t.Fatalf("%s routed to %q/%q, want %q/%q", tc.path, unit.Path, rel, tc.unit, tc.rel)
		}
	}
}

// Commit order is the whole mechanism: a nested unit must be committed before
// the unit that records its pointer, or the parent's gitlink would name a
// commit that does not exist yet.
func TestGroupOrdersWriteSetsDeepestFirst(t *testing.T) {
	units := Units{List: []Unit{
		{Path: RootUnitPath, Depth: 0, Measured: true},
		{Path: "services/app", Depth: 1, Measured: true, Initialized: true},
		{Path: "services/app/vendor/lib", Depth: 2, Measured: true, Initialized: true},
	}}
	sets := units.Group([]string{
		"README.md",
		"services/app/Dockerfile",
		"services/app/vendor/lib/x.go",
		"services/app/src/main.ts",
	})
	if len(sets) != 3 {
		t.Fatalf("expected one write set per owning repository, got %d: %+v", len(sets), sets)
	}
	want := []string{"services/app/vendor/lib", "services/app", RootUnitPath}
	for index, set := range sets {
		if set.Unit.Path != want[index] {
			t.Fatalf("write set %d is %q, want %q (deepest first)", index, set.Unit.Path, want[index])
		}
	}
	if len(sets[1].UnitPaths) != 2 || sets[1].UnitPaths[0] != "Dockerfile" || sets[1].UnitPaths[1] != "src/main.ts" {
		t.Fatalf("submodule paths must be rebased onto its own root, got %v", sets[1].UnitPaths)
	}
	if sets[1].ProjectPaths[0] != "services/app/Dockerfile" {
		t.Fatalf("project paths must survive unchanged, got %v", sets[1].ProjectPaths)
	}
}

func TestUnintegrableWritesNamesOnlyUnusableUnits(t *testing.T) {
	units := Units{List: []Unit{
		{Path: RootUnitPath, Depth: 0, Measured: true},
		{Path: "services/app", Depth: 1, Measured: true, Initialized: true},
		{Path: "services/be", Depth: 1, Unmeasurable: "no checkout"},
	}}
	blocked := units.UnintegrableWrites([]string{"README.md", "services/app/a.ts", "services/be/b.ts"})
	if len(blocked) != 1 {
		t.Fatalf("expected exactly the unusable unit, got %+v", blocked)
	}
	set, found := blocked["services/be"]
	if !found || len(set.ProjectPaths) != 1 || set.ProjectPaths[0] != "services/be/b.ts" {
		t.Fatalf("unexpected blocked write set: %+v", blocked)
	}
}

// A project Wharnex cannot measure has no units to route into and must behave
// exactly as a single-repository project always did.
func TestInspectUnitsFailsOnlyForAnUnmeasurableRoot(t *testing.T) {
	requireGit(t)
	if _, err := InspectUnits(context.Background(), t.TempDir()); err == nil {
		t.Fatal("expected an error for a directory that is not a repository")
	}
	root := newRepo(t, "a.txt", "a\n")
	units, err := InspectUnits(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if units.HasSubmodules() || len(units.List) != 1 {
		t.Fatalf("an ordinary project must measure as exactly one unit, got %+v", units.List)
	}
	unit, rel := units.Route("cmd/main.go")
	if !unit.IsRoot() || rel != "cmd/main.go" {
		t.Fatalf("an ordinary project must route every path to itself unchanged, got %q/%q", unit.Path, rel)
	}
}
