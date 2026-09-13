package hostrepo

import (
	"context"
	"path/filepath"
	"sort"
	"strings"
)

// RootUnitPath names the superproject in every unit-keyed map and event. It is
// the empty string so that a project-relative path and a unit-relative path are
// the same string for an ordinary project, which is what keeps every
// pre-submodule code path unchanged.
const RootUnitPath = ""

// maxUnitDepth bounds recursion into nested submodules. Four levels is far past
// anything observed in practice; the bound exists so a cyclic or pathological
// gitlink graph cannot turn a measurement into an unbounded walk.
const maxUnitDepth = 4

// Unit is one Git repository participating in a project.
//
// A project is a tree of these, not a single repository: the superproject is
// the root unit and every initialized submodule reachable from an index is a
// nested unit.
//
// This inventory is a READ-ONLY measurement. It exists to publish the project's
// repository topology to the planner (`wharness.repository/v1`, adr/ADR-0050)
// and performs no mutation; host-facing submodule integration is owned by
// internal/sandbox/repositorytree.go (adr/ADR-0039).
type Unit struct {
	// Path is the project-relative slash path of this unit's worktree root,
	// empty for the superproject.
	Path string
	// Root is the absolute worktree root.
	Root string
	// ParentPath is the Path of the unit whose index records this one. Only
	// meaningful when Depth > 0.
	ParentPath string
	// Depth is 0 for the superproject and increases by one per nesting level.
	Depth int
	// CommitSHA is the gitlink the parent's index records for this unit. Empty
	// for the superproject.
	CommitSHA string
	// Registered reports whether the parent's .gitmodules still describes it.
	Registered bool
	// Initialized reports whether the submodule has a working checkout at all.
	// An uninitialized submodule is an empty directory: there is nothing to
	// patch there and nothing to commit into.
	Initialized bool
	// Measured reports whether this unit's own topology could be read. A
	// gitlink Wharnex cannot inspect is still listed — routing must know the
	// boundary exists — but it is never treated as integrable.
	Measured bool
	// Topology is this unit's own measured shape, valid when Measured.
	Topology Topology
	// Unmeasurable carries why measurement failed, for events and diagnostics.
	Unmeasurable string
}

// Integrable reports whether Wharnex can run its Git integration inside this
// unit. The superproject always is, when it was measurable at all; a submodule
// must additionally have a real checkout of its own.
func (u Unit) Integrable() bool {
	if !u.Measured {
		return false
	}
	return u.Depth == 0 || u.Initialized
}

// IsRoot reports the superproject.
func (u Unit) IsRoot() bool { return u.Depth == 0 }

// Label names the unit in operator-facing text, since the superproject's own
// path is the empty string.
func (u Unit) Label() string {
	if u.IsRoot() {
		return "superproject"
	}
	return u.Path
}

// Units is one project's measured repository-unit tree, ordered root first and
// then by increasing depth.
type Units struct {
	List []Unit
}

// InspectUnits measures a project's whole repository-unit tree.
//
// It performs no mutation. Only the root's failure is an error: a submodule
// that cannot be measured is recorded as an unmeasurable unit rather than
// failing the whole inspection, because a project must stay usable when one of
// its submodules is broken or not checked out.
func InspectUnits(ctx context.Context, root string) (Units, error) {
	topology, err := Inspect(ctx, root)
	if err != nil {
		return Units{}, err
	}
	units := Units{List: []Unit{{
		Path: RootUnitPath, Root: topology.Root, Depth: 0,
		Initialized: true, Measured: true, Topology: topology,
	}}}
	for index := 0; index < len(units.List); index++ {
		parent := units.List[index]
		if !parent.Measured || parent.Depth >= maxUnitDepth {
			continue
		}
		for _, submodule := range parent.Topology.Submodules {
			units.List = append(units.List, measureSubmoduleUnit(ctx, parent, submodule))
		}
	}
	sort.SliceStable(units.List, func(i, j int) bool {
		if units.List[i].Depth != units.List[j].Depth {
			return units.List[i].Depth < units.List[j].Depth
		}
		return units.List[i].Path < units.List[j].Path
	})
	return units, nil
}

func measureSubmoduleUnit(ctx context.Context, parent Unit, submodule Submodule) Unit {
	path := joinUnitPath(parent.Path, submodule.Path)
	unit := Unit{
		Path:        path,
		Root:        filepath.Join(parent.Root, filepath.FromSlash(submodule.Path)),
		ParentPath:  parent.Path,
		Depth:       parent.Depth + 1,
		CommitSHA:   submodule.CommitSHA,
		Registered:  submodule.Registered,
		Initialized: submodule.Initialized,
	}
	if !submodule.Initialized {
		unit.Unmeasurable = "the submodule has no checkout; it was never initialized in this worktree"
		return unit
	}
	topology, err := Inspect(ctx, unit.Root)
	if err != nil {
		unit.Unmeasurable = truncate(err.Error(), 300)
		return unit
	}
	// A submodule directory that resolved to its parent's Git directory is not
	// a repository of its own — measuring it as one would make Wharnex commit
	// the parent while believing it was committing the child.
	if filepath.Clean(topology.GitDir) == filepath.Clean(parent.Topology.GitDir) {
		unit.Unmeasurable = "the path resolves to the parent repository rather than to its own"
		return unit
	}
	unit.Measured = true
	unit.Topology = topology
	return unit
}

func joinUnitPath(parent, child string) string {
	child = filepath.ToSlash(strings.TrimSpace(child))
	if parent == RootUnitPath {
		return child
	}
	return parent + "/" + child
}

// HeadSHA resolves a repository's current commit, empty when it has none.
func HeadSHA(ctx context.Context, root string) (string, bool) {
	output, err := run(ctx, root, "rev-parse", "--verify", "-q", "HEAD")
	if err != nil || strings.TrimSpace(output) == "" {
		return "", false
	}
	return strings.TrimSpace(output), true
}

// HasSubmodules reports whether this project is more than one repository.
func (u Units) HasSubmodules() bool { return len(u.List) > 1 }

func normalizeProjectPath(path string) string {
	path = filepath.ToSlash(strings.TrimSpace(path))
	path = strings.TrimPrefix(path, "./")
	return strings.TrimSuffix(path, "/")
}

func normalizeUnitPath(path string) string {
	path = normalizeProjectPath(path)
	if path == "." {
		return RootUnitPath
	}
	return path
}
