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
// nested unit. Wharnex performs its host-facing Git work — base capture,
// verified commit, local push, merge, revert — once per unit rather than once
// per project, which is what lets a change write inside a submodule (see
// adr/ADR-0050).
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

// UnitWriteSet is one unit's share of a plan's write set.
//
// ProjectPaths are as the planner wrote them; UnitPaths are the same paths
// relative to that unit's own worktree, which is what `git add` inside the unit
// needs. Keeping both is what lets Wharnex route passively while still
// reporting the paths the planner and the operator recognise.
type UnitWriteSet struct {
	Unit         Unit
	ProjectPaths []string
	UnitPaths    []string
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

// Root returns the superproject unit.
func (u Units) Root() Unit {
	for _, unit := range u.List {
		if unit.IsRoot() {
			return unit
		}
	}
	return Unit{}
}

// Lookup finds a unit by its project-relative path.
func (u Units) Lookup(path string) (Unit, bool) {
	path = normalizeUnitPath(path)
	for _, unit := range u.List {
		if unit.Path == path {
			return unit, true
		}
	}
	return Unit{}, false
}

// Submodules lists every non-root unit.
func (u Units) Submodules() []Unit {
	out := make([]Unit, 0, len(u.List))
	for _, unit := range u.List {
		if !unit.IsRoot() {
			out = append(out, unit)
		}
	}
	return out
}

// HasSubmodules reports whether this project is more than one repository.
func (u Units) HasSubmodules() bool { return len(u.List) > 1 }

// Route resolves a project-relative path to the unit that owns it and the path
// relative to that unit.
//
// Ownership is by longest matching prefix, which is what makes nested
// submodules work: `a/b/c.go` belongs to `a/b` when that is a unit, and to `a`
// otherwise. A path inside no submodule belongs to the superproject, and the
// returned relative path is then the path itself — so an ordinary project
// routes to exactly the values every pre-submodule call site already used.
func (u Units) Route(path string) (Unit, string) {
	path = normalizeProjectPath(path)
	best := u.Root()
	bestLen := -1
	for _, unit := range u.List {
		if unit.IsRoot() {
			continue
		}
		if path == unit.Path || strings.HasPrefix(path, unit.Path+"/") {
			if len(unit.Path) > bestLen {
				best, bestLen = unit, len(unit.Path)
			}
		}
	}
	if bestLen < 0 {
		return best, path
	}
	if path == best.Path {
		return best, "."
	}
	return best, strings.TrimPrefix(path, best.Path+"/")
}

// Group partitions a write set by owning unit, deepest first.
//
// The order is not cosmetic. A nested unit must be committed before the unit
// that records its pointer, or the parent's gitlink would name a commit that
// does not exist yet. Every caller that commits, pushes or merges consumes this
// order directly rather than re-deriving it.
func (u Units) Group(paths []string) []UnitWriteSet {
	grouped := map[string]*UnitWriteSet{}
	for _, path := range paths {
		normalized := normalizeProjectPath(path)
		if normalized == "" {
			continue
		}
		unit, rel := u.Route(normalized)
		set, known := grouped[unit.Path]
		if !known {
			set = &UnitWriteSet{Unit: unit}
			grouped[unit.Path] = set
		}
		set.ProjectPaths = append(set.ProjectPaths, normalized)
		set.UnitPaths = append(set.UnitPaths, rel)
	}
	out := make([]UnitWriteSet, 0, len(grouped))
	for _, set := range grouped {
		sort.Strings(set.ProjectPaths)
		sort.Strings(set.UnitPaths)
		out = append(out, *set)
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Unit.Depth != out[j].Unit.Depth {
			return out[i].Unit.Depth > out[j].Unit.Depth
		}
		return out[i].Unit.Path < out[j].Unit.Path
	})
	return out
}

// UnintegrableWrites reports the write sets whose unit Wharnex cannot integrate
// into, with the reason. These are the only writes that still have to be
// refused at ingestion: there is no checkout to patch and no repository to
// commit into, and no planner repair can change that.
func (u Units) UnintegrableWrites(paths []string) map[string]UnitWriteSet {
	blocked := map[string]UnitWriteSet{}
	for _, set := range u.Group(paths) {
		if !set.Unit.Integrable() {
			blocked[set.Unit.Path] = set
		}
	}
	return blocked
}

// PathsFor returns the subset of paths owned by one unit, as project paths.
func (u Units) PathsFor(unitPath string, paths []string) []string {
	unitPath = normalizeUnitPath(unitPath)
	owned := make([]string, 0, len(paths))
	for _, path := range paths {
		if unit, _ := u.Route(path); unit.Path == unitPath {
			owned = append(owned, normalizeProjectPath(path))
		}
	}
	return owned
}

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
