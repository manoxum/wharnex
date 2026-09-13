package sandbox

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"sort"
	"strings"

	"kernl.local/harness/backend/internal/hostrepo"
)

// UnitCommit is one repository unit's verified commit for a candidate.
type UnitCommit struct {
	// UnitPath is the project-relative unit root, empty for the superproject.
	UnitPath string
	// Branch is the integration branch inside that unit's own repository.
	Branch string
	// CommitSHA is what that branch pointed at right after it was created.
	CommitSHA string
	// PointerUpdates lists the child units whose gitlink this commit records,
	// as project-relative paths. Empty for a commit that only writes files.
	PointerUpdates []string
}

// UnitMerge records one unit's own host merge, which is what a revert needs to
// put that repository back exactly where it was.
type UnitMerge struct {
	UnitPath     string
	PreMergeSHA  string
	Preservation hostrepo.Preservation
}

// UnitsMerge is one candidate's whole host integration across every unit it
// touched, in the order the merges happened.
type UnitsMerge struct {
	Units         []UnitMerge
	SubmoduleSync hostrepo.SyncResult
}

// Root returns the superproject's own merge record.
func (m UnitsMerge) Root() (UnitMerge, bool) {
	for _, unit := range m.Units {
		if unit.UnitPath == hostrepo.RootUnitPath {
			return unit, true
		}
	}
	return UnitMerge{}, false
}

// SubmodulePaths lists the non-root units this integration merged into, which
// is what the operator has to be told about: those commits live only in their
// own local repositories until they push them.
func (m UnitsMerge) SubmodulePaths() []string {
	paths := make([]string, 0, len(m.Units))
	for _, unit := range m.Units {
		if unit.UnitPath != hostrepo.RootUnitPath {
			paths = append(paths, unit.UnitPath)
		}
	}
	return paths
}

// UnitCommitMessage builds one unit's commit message. The caller owns message
// policy (sanitization, trailers, the plan's own text); this package only says
// which unit is being committed and which pointers the commit records.
type UnitCommitMessage func(unit hostrepo.Unit, pointerUpdates []string) string

// CommitVerifiedUnits commits a verified sandbox's applied patch into every
// repository unit it wrote to, deepest unit first.
//
// Depth order is the whole mechanism. A submodule's change is a commit in that
// submodule's own repository; the superproject cannot hold those bytes at all,
// only a pointer to the commit that does. So the child is committed first, and
// each parent then stages the gitlink of every child that moved — including
// parents whose own file set is empty, because recording the pointer is the
// only way the superproject can describe what was verified.
//
// sets must already be grouped and ordered by hostrepo.Units.Group. units is
// the measured tree those sets came from, which is what lets a parent with no
// file changes of its own still be found and committed. rooted names the units
// whose integration branch a base-rooted checkout already opened, which must
// not be created a second time.
func CommitVerifiedUnits(
	ctx context.Context,
	workspacePath, branch string,
	units hostrepo.Units,
	sets []hostrepo.UnitWriteSet,
	rooted map[string]bool,
	message UnitCommitMessage,
) ([]UnitCommit, error) {
	if strings.TrimSpace(branch) == "" {
		return nil, errors.New("branch name is required")
	}
	if len(sets) == 0 {
		return nil, errors.New("at least one changed path is required")
	}
	work := map[string]*hostrepo.UnitWriteSet{}
	order := make([]hostrepo.Unit, 0, len(sets))
	for index := range sets {
		set := sets[index]
		if !set.Unit.Integrable() {
			return nil, fmt.Errorf("unit %s cannot be integrated: %s", set.Unit.Label(), set.Unit.Unmeasurable)
		}
		copied := set
		work[set.Unit.Path] = &copied
		order = append(order, set.Unit)
	}
	pointers := map[string][]string{}
	commits := make([]UnitCommit, 0, len(sets))
	for {
		unit, ok := deepestPendingUnit(order)
		if !ok {
			break
		}
		order = removeUnit(order, unit.Path)
		set := work[unit.Path]
		if set == nil {
			set = &hostrepo.UnitWriteSet{Unit: unit}
		}
		stage := append([]string(nil), set.UnitPaths...)
		pointerUpdates := pointers[unit.Path]
		sort.Strings(pointerUpdates)
		for _, pointer := range pointerUpdates {
			stage = append(stage, unitRelativePath(unit.Path, pointer))
		}
		if len(stage) == 0 {
			continue
		}
		unitRoot := unitWorkspaceRoot(workspacePath, unit.Path)
		if !rooted[unit.Path] {
			if output, err := runGit(ctx, unitRoot, "checkout", "-b", branch); err != nil {
				return nil, fmt.Errorf("create integration branch %s in %s: %s", branch, unit.Label(), output)
			}
		}
		if output, err := runGit(ctx, unitRoot, append([]string{"add", "--"}, stage...)...); err != nil {
			return nil, fmt.Errorf("stage verified changes in %s: %s", unit.Label(), output)
		}
		commitArgs := []string{
			"-c", "user.name=" + gitCommitAuthorName,
			"-c", "user.email=" + gitCommitAuthorEmail,
			"-c", "commit.gpgSign=false",
			"commit", "-q", "-m", message(unit, pointerUpdates),
		}
		if output, err := runGit(ctx, unitRoot, commitArgs...); err != nil {
			return nil, fmt.Errorf("commit verified changes in %s: %s", unit.Label(), output)
		}
		sha, err := CurrentHeadSHA(ctx, unitRoot)
		if err != nil {
			return nil, fmt.Errorf("resolve integration commit in %s: %w", unit.Label(), err)
		}
		commits = append(commits, UnitCommit{UnitPath: unit.Path, Branch: branch, CommitSHA: sha, PointerUpdates: pointerUpdates})
		if !unit.IsRoot() {
			pointers[unit.ParentPath] = append(pointers[unit.ParentPath], unit.Path)
			if _, queued := work[unit.ParentPath]; !queued && !containsUnit(order, unit.ParentPath) {
				// The parent has no file changes of its own but must still
				// record where its child landed, or the superproject would
				// describe none of the verified work.
				parent, found := units.Lookup(unit.ParentPath)
				if !found || !parent.Integrable() {
					return nil, fmt.Errorf("unit %s has no measured parent to record its pointer in", unit.Label())
				}
				order = append(order, parent)
			}
		}
	}
	if len(commits) == 0 {
		return nil, errors.New("no repository unit had anything to commit")
	}
	return commits, nil
}

// PushUnitsToHost transfers every unit's integration branch into that unit's
// own .git on the host, by absolute filesystem path. Never a network remote and
// never the operator's configured origin, exactly as the superproject push has
// always worked.
// A failure part-way through is unwound: every unit already published in this
// call has its branch deleted again. Without that, a candidate that published
// two submodules and failed on the third would leave two refs behind in
// repositories the operator owns, for a candidate that never existed — and the
// next attempt at the same request id would then fail to create the branch it
// had apparently already pushed.
func PushUnitsToHost(ctx context.Context, workspacePath, hostPath string, commits []UnitCommit) error {
	published := make([]UnitCommit, 0, len(commits))
	for _, commit := range commits {
		source := unitWorkspaceRoot(workspacePath, commit.UnitPath)
		destination := unitWorkspaceRoot(hostPath, commit.UnitPath)
		if output, err := runGit(ctx, source, "push", "--no-verify", "--", destination, commit.Branch+":refs/heads/"+commit.Branch); err != nil {
			DeleteHostUnitBranches(ctx, hostPath, published)
			return fmt.Errorf("push integration branch into %s: %s", unitLabel(commit.UnitPath), output)
		}
		published = append(published, commit)
	}
	return nil
}

// UnitCheckout is a repository unit's own checkout as it stood at one moment:
// the branch it was on, empty when detached, and the commit that branch pointed
// at.
type UnitCheckout struct {
	TargetBranch string
	BaseCommit   string
}

// CaptureUnitCheckouts records what each unit's checkout looked like, so a
// later Apply can prove it is still integrating into what it verified.
func CaptureUnitCheckouts(ctx context.Context, root string, unitPaths []string) map[string]UnitCheckout {
	checkouts := map[string]UnitCheckout{}
	for _, unitPath := range unitPaths {
		unitRoot := unitWorkspaceRoot(root, unitPath)
		topology, err := hostrepo.Inspect(ctx, unitRoot)
		if err != nil {
			continue
		}
		head, _ := CurrentHeadSHA(ctx, unitRoot)
		checkouts[unitPath] = UnitCheckout{TargetBranch: topology.Branch, BaseCommit: head}
	}
	return checkouts
}

// UnitDriftError reports a repository unit whose checkout moved between
// verification and Apply.
type UnitDriftError struct {
	UnitPath string
	Detail   string
}

func (e *UnitDriftError) Error() string {
	return fmt.Sprintf("%s moved since this change was verified: %s", unitLabel(e.UnitPath), e.Detail)
}

// GuardUnitDrift refuses an Apply whose submodule checkouts are no longer the
// ones the candidate was verified against.
//
// Verification commits inside a submodule's own repository and records which
// branch that repository was on. Between then and Apply the operator may check
// that submodule out onto something else entirely — a different feature branch,
// or a detached bisect. Merging anyway would advance a branch the candidate was
// never built against, in a repository Wharnex does not own. It is checked
// before any unit is touched, so a refusal costs nothing and leaves the whole
// project exactly as it was.
//
// A unit with no recorded checkout is not guarded: candidates persisted before
// this was recorded keep their previous behavior rather than becoming
// unappliable.
func GuardUnitDrift(ctx context.Context, hostPath string, checkouts map[string]UnitCheckout) error {
	paths := make([]string, 0, len(checkouts))
	for unitPath := range checkouts {
		paths = append(paths, unitPath)
	}
	sort.Strings(paths)
	for _, unitPath := range paths {
		expected := checkouts[unitPath]
		if unitPath == hostrepo.RootUnitPath || expected.TargetBranch == "" {
			continue
		}
		unitRoot := unitWorkspaceRoot(hostPath, unitPath)
		topology, err := hostrepo.Inspect(ctx, unitRoot)
		if err != nil {
			return &UnitDriftError{UnitPath: unitPath, Detail: "it can no longer be measured as a repository"}
		}
		if topology.Branch != expected.TargetBranch {
			current := topology.Branch
			if current == "" {
				current = "a detached HEAD"
			}
			return &UnitDriftError{
				UnitPath: unitPath,
				Detail:   fmt.Sprintf("it was verified on branch %s and is now on %s", expected.TargetBranch, current),
			}
		}
	}
	return nil
}

// FetchBranchFromHostUnits pulls one candidate's integration branch out of the
// host and into the matching repository of another tree — the verification
// sandbox, when an earlier pending candidate is replayed on top of. Each unit
// fetches from its own counterpart, by absolute path and with no network.
func FetchBranchFromHostUnits(ctx context.Context, workspacePath, hostPath, branch string, unitPaths []string) error {
	for _, unitPath := range orderUnitsDeepestFirst(unitPaths) {
		source := unitWorkspaceRoot(hostPath, unitPath)
		target := unitWorkspaceRoot(workspacePath, unitPath)
		if err := FetchBranchFromHost(ctx, target, source, branch); err != nil {
			return fmt.Errorf("%s: %w", unitLabel(unitPath), err)
		}
	}
	return nil
}

// MergeUnitsOnHost merges one candidate's integration branch into every unit it
// was committed in, deepest first.
//
// Each unit receives the complete host-integration treatment in its own
// repository: shape measurement, refusal on an unfinished operation or
// unresolved paths, preservation of the operator's uncommitted work, and its
// own recorded pre-merge commit. Merging children first is what lets the
// superproject's own merge land gitlinks on submodules that already hold the
// commits those gitlinks name.
func MergeUnitsOnHost(ctx context.Context, hostPath, branch string, unitPaths []string) (UnitsMerge, error) {
	ordered := orderUnitsDeepestFirst(unitPaths)
	integrating := map[string]bool{}
	for _, path := range ordered {
		if path != hostrepo.RootUnitPath {
			integrating[path] = true
		}
	}
	result := UnitsMerge{}
	for _, unitPath := range ordered {
		unitRoot := unitWorkspaceRoot(hostPath, unitPath)
		merge, err := mergeOneUnit(ctx, unitRoot, unitPath, branch, integrating)
		if merge.PreMergeSHA != "" || merge.Preservation.Committed {
			result.Units = append(result.Units, merge.UnitMerge)
		}
		if err != nil {
			return result, err
		}
		if unitPath == hostrepo.RootUnitPath {
			result.SubmoduleSync = merge.sync
		}
	}
	return result, nil
}

type unitMergeResult struct {
	UnitMerge
	sync hostrepo.SyncResult
}

func mergeOneUnit(ctx context.Context, unitRoot, unitPath, branch string, integrating map[string]bool) (unitMergeResult, error) {
	result := unitMergeResult{UnitMerge: UnitMerge{UnitPath: unitPath}}
	topology, err := hostrepo.Inspect(ctx, unitRoot)
	if err != nil {
		return result, fmt.Errorf("measure %s before merge: %w", unitLabel(unitPath), err)
	}
	// Units this same integration is merging are excluded from the snapshot.
	// The submodules merged a moment ago, which moved their gitlinks here; a
	// snapshot that captured them would commit Wharnex's own work into the
	// operator's history and move the rollback boundary past it.
	preservation, err := hostrepo.PreserveExcept(ctx, unitRoot, hostSnapshotMessage, childUnitsOf(unitPath, integrating))
	if err != nil {
		return result, err
	}
	result.Preservation = preservation
	if err := hostrepo.GuardDirtySubmodulesExcept(ctx, unitRoot, branch, preservation.DirtySubmodules, integrating); err != nil {
		return result, err
	}
	result.PreMergeSHA, err = CurrentHeadSHA(ctx, unitRoot)
	if err != nil {
		return result, err
	}
	preMerge, preMergeErr := hostrepo.Inspect(ctx, unitRoot)
	if preMergeErr != nil {
		preMerge = topology
	}
	mergeArgs := append(hostrepo.InternalGitArgs(topology), "merge", "--no-ff", "--no-edit", branch)
	if output, mergeErr := runGit(ctx, unitRoot, mergeArgs...); mergeErr != nil {
		conflicted, conflictErr := runGit(ctx, unitRoot, "diff", "--name-only", "--diff-filter=U")
		if conflictErr == nil && strings.TrimSpace(conflicted) != "" {
			paths := strings.Fields(conflicted)
			managed, ordinary := partitionManagedMergePaths(projectPathsFor(unitPath, paths))
			if len(managed) > 0 && len(ordinary) == 0 {
				if preserveErr := preserveManagedMergeConflicts(ctx, unitRoot, topology, result.PreMergeSHA, unitPathsFor(unitPath, managed)); preserveErr == nil {
					result.sync, _ = hostrepo.SyncSubmodules(ctx, unitRoot, preMerge.Submodules)
					return result, nil
				} else {
					_, _ = runGit(ctx, unitRoot, "merge", "--abort")
					return result, preserveErr
				}
			}
			_, _ = runGit(ctx, unitRoot, "merge", "--abort")
			mergeBase, _ := runGit(ctx, unitRoot, "merge-base", result.PreMergeSHA, branch)
			return result, &MergeConflictError{
				Unit: unitPath, Paths: ordinary, Branch: branch,
				HostSHA: result.PreMergeSHA, MergeBaseSHA: mergeBase,
			}
		}
		_, _ = runGit(ctx, unitRoot, "merge", "--abort")
		return result, fmt.Errorf("merge integration branch into %s: %s", unitLabel(unitPath), output)
	}
	if err := recordIntegratedGitlinks(ctx, unitRoot, topology, result.PreMergeSHA, childUnitsOf(unitPath, integrating)); err != nil {
		return result, err
	}
	result.sync, _ = hostrepo.SyncSubmodules(ctx, unitRoot, preMerge.Submodules)
	return result, nil
}

// recordIntegratedGitlinks corrects the pointers a just-completed merge wrote
// for the submodules this same integration merged.
//
// The merge resolves each gitlink to the commit the candidate's branch recorded
// — the commit made in the SANDBOX. On the host that submodule has since been
// merged, so it is sitting on a different commit: the merge of the host's own
// prior state with that sandbox commit. Leaving the superproject pointing at
// the sandbox commit is not a cosmetic discrepancy. The realignment pass that
// runs next would check the submodule out at that stale pointer, discarding
// whatever the host-side merge preserved there — including the snapshot commit
// holding the operator's own uncommitted work.
//
// The correction is folded into the merge commit rather than added after it, so
// the operator's history carries one commit per change rather than a merge
// followed by an unexplained pointer fixup.
func recordIntegratedGitlinks(ctx context.Context, unitRoot string, topology hostrepo.Topology, preMergeSHA string, children []string) error {
	staged := make([]string, 0, len(children))
	for _, child := range children {
		recorded, known := hostrepo.GitlinkAt(ctx, unitRoot, "HEAD", child)
		actual, resolved := hostrepo.HeadSHA(ctx, filepath.Join(unitRoot, filepath.FromSlash(child)))
		if !known || !resolved || recorded == actual {
			continue
		}
		if output, err := runGit(ctx, unitRoot, "add", "--", child); err != nil {
			return fmt.Errorf("record integrated submodule pointer %s: %s", child, output)
		}
		staged = append(staged, child)
	}
	if len(staged) == 0 {
		return nil
	}
	commitArgs := append(hostrepo.InternalGitArgs(topology), "commit", "-q", "--no-verify")
	if head, _ := CurrentHeadSHA(ctx, unitRoot); head != preMergeSHA && head != "" {
		// This merge created the commit at HEAD moments ago, so folding the
		// corrected pointers into it is safe. When the merge changed nothing
		// (already up to date) HEAD is still the operator's own commit and must
		// never be rewritten, so the correction becomes its own commit.
		commitArgs = append(commitArgs, "--amend", "--no-edit")
	} else {
		commitArgs = append(commitArgs, "-m", "Wharnex: record integrated submodule commit(s): "+strings.Join(staged, ", "))
	}
	if output, err := runGit(ctx, unitRoot, commitArgs...); err != nil {
		return fmt.Errorf("record integrated submodule pointers: %s", output)
	}
	return nil
}

// RevertHostUnits undoes every unit this integration moved, superproject first
// so its gitlinks are restored before each submodule is put back.
//
// Reverting every unit is not optional. A revert that reset only the
// superproject would leave each submodule sitting on a merge commit the
// superproject no longer names — a repository permanently reporting itself
// ahead, which is the condition that used to make every subsequent Apply fail
// before it began.
func RevertHostUnits(ctx context.Context, hostPath string, merge UnitsMerge) error {
	ordered := append([]UnitMerge(nil), merge.Units...)
	sort.SliceStable(ordered, func(i, j int) bool {
		return unitDepth(ordered[i].UnitPath) < unitDepth(ordered[j].UnitPath)
	})
	var failures []string
	for _, unit := range ordered {
		if strings.TrimSpace(unit.PreMergeSHA) == "" {
			continue
		}
		unitRoot := unitWorkspaceRoot(hostPath, unit.UnitPath)
		if output, err := runGit(ctx, unitRoot, "reset", "--hard", unit.PreMergeSHA); err != nil {
			failures = append(failures, fmt.Sprintf("%s: %s", unitLabel(unit.UnitPath), output))
		}
	}
	if len(failures) > 0 {
		return fmt.Errorf("revert host merge: %s", strings.Join(failures, "; "))
	}
	return nil
}

// DeleteHostUnitBranches best-effort removes each unit's integration branch
// after a successful Apply. The merge commits stay in every unit's log
// regardless of whether this cleanup succeeds.
func DeleteHostUnitBranches(ctx context.Context, hostPath string, commits []UnitCommit) []string {
	failures := make([]string, 0)
	for _, commit := range commits {
		unitRoot := unitWorkspaceRoot(hostPath, commit.UnitPath)
		if output, err := runGit(ctx, unitRoot, "branch", "-D", commit.Branch); err != nil {
			failures = append(failures, fmt.Sprintf("%s: %s", unitLabel(commit.UnitPath), output))
		}
	}
	return failures
}

// UnitRepoPath resolves where a unit's repository lives under a project or
// workspace root, so callers reading refs or files inside a unit do not have to
// rebuild the join — and cannot accidentally read the superproject instead.
func UnitRepoPath(root, unitPath string) string { return unitWorkspaceRoot(root, unitPath) }

// UnitRelativePath expresses a project-relative path relative to a unit root,
// which is how a reader addresses a conflicting file inside that unit's own
// repository while still showing the planner the path it wrote.
func UnitRelativePath(unitPath, projectPath string) string {
	return unitRelativePath(unitPath, projectPath)
}

func unitWorkspaceRoot(root, unitPath string) string {
	unitPath = strings.TrimSpace(unitPath)
	if unitPath == "" || unitPath == "." {
		return root
	}
	return filepath.Join(root, filepath.FromSlash(unitPath))
}

// childUnitsOf lists the integrating units that live inside one unit, expressed
// relative to it — the exact pathspecs whose gitlink that unit's own snapshot
// must leave alone.
func childUnitsOf(unitPath string, integrating map[string]bool) []string {
	children := make([]string, 0, len(integrating))
	for candidate := range integrating {
		if candidate == unitPath {
			continue
		}
		if unitPath == hostrepo.RootUnitPath || strings.HasPrefix(candidate, unitPath+"/") {
			children = append(children, unitRelativePath(unitPath, candidate))
		}
	}
	sort.Strings(children)
	return children
}

func unitLabel(unitPath string) string {
	if strings.TrimSpace(unitPath) == "" {
		return "the superproject"
	}
	return "submodule " + unitPath
}

func unitDepth(unitPath string) int {
	unitPath = strings.TrimSpace(unitPath)
	if unitPath == "" {
		return 0
	}
	return strings.Count(unitPath, "/") + 1
}

func orderUnitsDeepestFirst(unitPaths []string) []string {
	seen := map[string]bool{}
	ordered := make([]string, 0, len(unitPaths))
	for _, path := range unitPaths {
		path = strings.TrimSuffix(strings.TrimSpace(path), "/")
		if path == "." {
			path = hostrepo.RootUnitPath
		}
		if seen[path] {
			continue
		}
		seen[path] = true
		ordered = append(ordered, path)
	}
	sort.SliceStable(ordered, func(i, j int) bool {
		if unitDepth(ordered[i]) != unitDepth(ordered[j]) {
			return unitDepth(ordered[i]) > unitDepth(ordered[j])
		}
		return ordered[i] < ordered[j]
	})
	return ordered
}

// unitRelativePath expresses a project path relative to a unit root.
func unitRelativePath(unitPath, projectPath string) string {
	if strings.TrimSpace(unitPath) == "" {
		return projectPath
	}
	return strings.TrimPrefix(projectPath, unitPath+"/")
}

// projectPathsFor lifts unit-relative paths back into project paths, which is
// what every operator-facing and planner-facing surface must show: the planner
// wrote project paths and must never be handed a path rebased onto a repository
// boundary it was not told about.
func projectPathsFor(unitPath string, paths []string) []string {
	if strings.TrimSpace(unitPath) == "" {
		return paths
	}
	out := make([]string, 0, len(paths))
	for _, path := range paths {
		out = append(out, unitPath+"/"+path)
	}
	return out
}

func unitPathsFor(unitPath string, paths []string) []string {
	out := make([]string, 0, len(paths))
	for _, path := range paths {
		out = append(out, unitRelativePath(unitPath, path))
	}
	return out
}

func deepestPendingUnit(units []hostrepo.Unit) (hostrepo.Unit, bool) {
	best := hostrepo.Unit{}
	found := false
	for _, unit := range units {
		if !found || unit.Depth > best.Depth {
			best, found = unit, true
		}
	}
	return best, found
}

func removeUnit(units []hostrepo.Unit, path string) []hostrepo.Unit {
	out := units[:0]
	for _, unit := range units {
		if unit.Path != path {
			out = append(out, unit)
		}
	}
	return out
}

func containsUnit(units []hostrepo.Unit, path string) bool {
	for _, unit := range units {
		if unit.Path == path {
			return true
		}
	}
	return false
}
