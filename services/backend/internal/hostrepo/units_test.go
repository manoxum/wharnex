package hostrepo

import (
	"context"
	"testing"
)

// The inventory behind the published repository topology must see every
// repository the project is really made of, and must not mistake a submodule
// for its parent: measuring them as one repository is how a tool ends up
// reporting the superproject's state for a submodule's.
func TestInspectUnitsMeasuresTheWholeTree(t *testing.T) {
	requireGit(t)
	root, _ := newRepoWithSubmodule(t, "services/app")

	units, err := InspectUnits(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if !units.HasSubmodules() || len(units.List) != 2 {
		t.Fatalf("expected the superproject and one submodule, got %+v", units.List)
	}
	superproject := units.List[0]
	if !superproject.IsRoot() || superproject.Path != RootUnitPath || !superproject.Integrable() {
		t.Fatalf("unexpected superproject unit: %+v", superproject)
	}
	submodule := units.List[1]
	if submodule.Path != "services/app" || !submodule.Integrable() || submodule.Depth != 1 {
		t.Fatalf("unexpected submodule unit: %+v", submodule)
	}
	if submodule.ParentPath != RootUnitPath || submodule.CommitSHA == "" {
		t.Fatalf("the unit must carry its parent and the gitlink recorded for it: %+v", submodule)
	}
	if submodule.Topology.GitDir == superproject.Topology.GitDir {
		t.Fatal("the submodule resolved to its parent's Git directory")
	}
	if submodule.Label() != "services/app" || superproject.Label() != "superproject" {
		t.Fatal("units must name themselves for operator-facing text")
	}
}

// A submodule with no checkout is still listed — the manifest has to say the
// boundary exists — but must never be reported as able to receive a patch.
func TestInspectUnitsListsAnUninitializedSubmoduleAsUnintegrable(t *testing.T) {
	requireGit(t)
	origin, _ := newRepoWithSubmodule(t, "services/app")
	clone := t.TempDir()
	git(t, clone, "clone", "-q", "--", origin, "copy")

	units, err := InspectUnits(context.Background(), clone+"/copy")
	if err != nil {
		t.Fatal(err)
	}
	if len(units.List) != 2 {
		t.Fatalf("an uninitialized submodule must still be listed: %+v", units.List)
	}
	submodule := units.List[1]
	if submodule.Integrable() || submodule.Initialized {
		t.Fatalf("an uninitialized submodule must not be integrable: %+v", submodule)
	}
	if submodule.Unmeasurable == "" {
		t.Fatal("an unintegrable unit must say why")
	}
}

// An ordinary project must measure as exactly one repository, so the manifest
// stays absent and nothing about that project's handling changes.
func TestInspectUnitsMeasuresAnOrdinaryProjectAsOneRepository(t *testing.T) {
	requireGit(t)
	if _, err := InspectUnits(context.Background(), t.TempDir()); err == nil {
		t.Fatal("expected an error for a directory that is not a repository")
	}
	units, err := InspectUnits(context.Background(), newRepo(t, "a.txt", "a\n"))
	if err != nil {
		t.Fatal(err)
	}
	if units.HasSubmodules() || len(units.List) != 1 {
		t.Fatalf("an ordinary project must measure as exactly one unit, got %+v", units.List)
	}
}
