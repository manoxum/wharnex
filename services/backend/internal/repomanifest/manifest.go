// Package repomanifest describes the repository topology a planner's patch
// will actually be integrated into: the superproject and every submodule that
// is a real repository of its own.
//
// It exists for the same reason internal/sandboxenv does. A remote planner that
// cannot see the layout guesses, and for a deployment superproject whose entire
// source lives in submodules the guess is expensive in both directions: either
// it avoids the only paths that can answer the request, or it writes them while
// explaining the change as though one repository held everything.
//
// The manifest is descriptive only. Routing a path to the repository that owns
// it is a measurement Wharnex performs itself (internal/hostrepo), and nothing
// here grants a capability, relaxes a check, or lets a plan select a
// repository. It states what is already true so the planner's prose, commit
// message and impact set can be true as well.
package repomanifest

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"kernl.local/harness/backend/internal/hostrepo"
)

// SchemaVersion identifies the wire shape published to the planner. Bump it
// when the JSON changes incompatibly.
const SchemaVersion = "wharness.repository/v1"

// Manifest is the complete repository description attached to a planner
// request. Every field is Wharnex-measured; none of it is planner-supplied.
type Manifest struct {
	Schema string `json:"schema"`
	// Units lists the superproject first, then every submodule by depth.
	Units []Unit `json:"units"`
	// Warnings names units Wharnex could not measure, so a planner reading an
	// incomplete inventory knows it is incomplete.
	Warnings []string `json:"warnings,omitempty"`
}

// Unit is one repository in the project.
//
// Remote URLs are deliberately absent, for the same reason the project export
// omits them: they carry credentials often enough that publishing them is not
// worth the marginal context.
type Unit struct {
	// Path is the project-relative worktree root, empty for the superproject.
	Path string `json:"path"`
	// Role is "superproject" or "submodule".
	Role string `json:"role"`
	// Head is the unit's current commit.
	Head string `json:"head,omitempty"`
	// Branch is the checked-out branch, empty when detached — which is the
	// ordinary resting state of a submodule, not a fault.
	Branch string `json:"branch,omitempty"`
	// Detached reports a HEAD that is not on a branch.
	Detached bool `json:"detached,omitempty"`
	// Initialized reports whether a submodule has a checkout at all.
	Initialized bool `json:"initialized"`
	// Registered reports whether .gitmodules still describes it.
	Registered bool `json:"registered,omitempty"`
	// RecordedCommit is the gitlink the parent's index holds for this unit.
	RecordedCommit string `json:"recorded_commit,omitempty"`
	// Patchable reports whether a patch writing here can be verified and
	// integrated. False means the change cannot be delivered at those paths at
	// all, whatever the patch says.
	Patchable bool `json:"patchable"`
	// Reason explains a false Patchable.
	Reason string `json:"reason,omitempty"`
}

// Measure builds the manifest for a project. A project Wharnex cannot inspect
// returns an empty manifest rather than an error: the section is valuable but
// never load bearing, exactly like the environment measurement.
func Measure(ctx context.Context, projectPath string) Manifest {
	manifest := Manifest{Schema: SchemaVersion}
	units, err := hostrepo.InspectUnits(ctx, projectPath)
	if err != nil {
		return manifest
	}
	for _, unit := range units.List {
		entry := Unit{
			Path:           unit.Path,
			Role:           "submodule",
			Initialized:    unit.Initialized,
			Registered:     unit.Registered,
			RecordedCommit: unit.CommitSHA,
			Patchable:      unit.Integrable(),
			Reason:         unit.Unmeasurable,
		}
		if unit.IsRoot() {
			entry.Role = "superproject"
		}
		if unit.Measured {
			entry.Head = headOf(ctx, unit)
			entry.Branch = unit.Topology.Branch
			entry.Detached = unit.Topology.Detached
		}
		if !entry.Patchable && entry.Reason != "" {
			manifest.Warnings = append(manifest.Warnings, unit.Label()+": "+entry.Reason)
		}
		manifest.Units = append(manifest.Units, entry)
	}
	return manifest
}

func headOf(ctx context.Context, unit hostrepo.Unit) string {
	if !unit.Topology.HeadBorn {
		return ""
	}
	head, _ := hostrepo.HeadSHA(ctx, unit.Root)
	return head
}

// HasSubmodules reports whether this project is more than one repository, which
// is the only case where the section is worth a planner's attention.
func (m Manifest) HasSubmodules() bool { return len(m.Units) > 1 }

// Render produces the LOCAL REPOSITORY TOPOLOGY prompt section.
//
// It returns "" for an ordinary single-repository project. Publishing a section
// that says "this project is one repository" to every request would spend
// context on a fact the planner already assumes, and would train planners to
// skim past the section in the case that actually matters.
func (m Manifest) Render() string {
	if !m.HasSubmodules() {
		return ""
	}
	payload, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return ""
	}
	var out strings.Builder
	fmt.Fprintf(&out, "LOCAL REPOSITORY TOPOLOGY — %s — HARNESS MEASUREMENT, NOT A REQUEST:\n", SchemaVersion)
	out.WriteString(strings.Join([]string{
		"- This project is a Git superproject with submodules. Each unit below is a SEPARATE repository with its own history.",
		"- Write ordinary project-relative paths. Wharnex routes every patched path to the repository that owns it, commits it there, records the moved pointer in the parent, and merges both. You do not select a repository and there is no protocol field for one.",
		"- A path inside a `patchable: true` submodule is real, editable source. Treat it exactly like any other project file.",
		"- A `patchable: false` unit cannot receive a change at all: there is no checkout to patch. Do not write there; say so in the summary instead.",
		"- `commit_message` is used for every repository the change touches, so write it to describe the change as a whole rather than one file's repository.",
		"- Submodule commits Wharnex makes stay local until a human pushes them. Never propose pushing, and never propose editing `.gitmodules` pointers or gitlink entries — a submodule pointer is a commit id, not patchable content.",
	}, "\n"))
	out.WriteString("\n")
	out.Write(payload)
	out.WriteString("\n")
	return out.String()
}
