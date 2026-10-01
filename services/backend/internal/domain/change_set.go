package domain

import "time"

type FileMutation struct {
	Path          string `json:"path"`
	BaseSHA256    string `json:"base_sha256,omitempty"`
	ResultSHA256  string `json:"result_sha256,omitempty"`
	BaseExists    bool   `json:"base_exists"`
	ResultExists  bool   `json:"result_exists"`
	BaseContent   string `json:"base_content,omitempty"`
	ResultContent string `json:"result_content,omitempty"`
	BaseMode      uint32 `json:"base_mode,omitempty"`
	ResultMode    uint32 `json:"result_mode,omitempty"`
}

type ChangeSet struct {
	ID            string             `json:"id"`
	BaseRevision  string             `json:"base_revision"`
	Mutations     []FileMutation     `json:"mutations"`
	ReadFiles     []string           `json:"read_files,omitempty"`
	BarrierFiles  []string           `json:"barrier_files,omitempty"`
	ReadHashes    map[string]string  `json:"read_hashes,omitempty"`
	BarrierHashes map[string]string  `json:"barrier_hashes,omitempty"`
	State         IntegrationOutcome `json:"state"`
	CreatedAt     time.Time          `json:"created_at"`
}

// ConflictComplexity says what kind of work an unresolved conflict still
// needs, so escalation is chosen on evidence rather than on the mere fact that
// the merge did not come out clean.
//
// The distinction matters because the three classes have different correct
// destinations: a structural collision has no textual reconciliation at all, a
// semantic one needs the intent behind each side and is exactly what a planner
// round buys, and a mechanical one must never leave the machine.
type ConflictComplexity string

const (
	// ConflictComplexityMechanical is a collision the local ladder reconciled,
	// or could reconcile on a retry. It never escalates.
	ConflictComplexityMechanical ConflictComplexity = "mechanical"
	// ConflictComplexitySemantic is a bounded textual collision where both
	// sides rewrote the same region. A planner that sees both intents can
	// resolve it.
	ConflictComplexitySemantic ConflictComplexity = "semantic"
	// ConflictComplexityStructural is create/delete, binary content or file
	// mode: there is no text to reconcile and a patch cannot express the
	// answer.
	ConflictComplexityStructural ConflictComplexity = "structural"
)

type IntegrationConflictDetail struct {
	ChangeSetID string `json:"change_set_id"`
	Path        string `json:"path"`
	Reason      string `json:"reason"`
	// Complexity and the counters below are the integrator's own assessment of
	// what it tried. They travel with the conflict so the escalation decision,
	// the conflict capsule and the operator all read the same evidence.
	Complexity    ConflictComplexity `json:"complexity,omitempty"`
	Hunks         int                `json:"hunks,omitempty"`
	ResolvedHunks int                `json:"resolved_hunks,omitempty"`
	ConflictLines int                `json:"conflict_lines,omitempty"`
}

// ConflictPathSource records where one conflicting path's BASE and RESULT
// versions can still be read from once the round that discovered it has ended.
//
// A conflict thread can own paths discovered by more than one candidate:
// applying several pending candidates in one pass may collide on candidate A,
// receive a resolution, and then collide on candidate B on the very next
// Apply. Keeping each path's own source is what lets a later round rebuild the
// capsule for every path the thread still owes a resolution, instead of only
// the paths of the most recent collision.
type ConflictPathSource struct {
	// PlanID is the candidate whose integration branch collided on this path.
	// It is what retirement needs: the conflicting content has to be removed
	// from that specific candidate, or it collides again on the next Apply.
	PlanID string `json:"plan_id,omitempty"`
	// CandidateSHA is that candidate's own commit (RESULT).
	CandidateSHA string `json:"candidate_sha,omitempty"`
	// MergeBaseSHA is the common ancestor the collision was measured against
	// (BASE). CURRENT is always re-read from the host as it is now.
	MergeBaseSHA string `json:"merge_base_sha,omitempty"`
}

type ConflictResolution struct {
	ID              string   `json:"id"`
	RequestID       string   `json:"request_id"`
	OriginalPlanIDs []string `json:"original_plan_ids"`
	Paths           []string `json:"paths"`
	// PathSources maps each entry in Paths to the commits its BASE and RESULT
	// versions are read from. See ConflictPathSource.
	PathSources map[string]ConflictPathSource `json:"path_sources,omitempty"`
	Details     []IntegrationConflictDetail   `json:"details"`
	// AttemptHistory records what each earlier round of this same conflict
	// tried, oldest first. It travels back to the resolver so a repeated
	// collision is visibly a repeated collision: without it every round looks
	// like the first one and the same losing reconciliation can be proposed
	// indefinitely, which is the failure mode a bounded attempt count alone
	// only truncates rather than informs.
	AttemptHistory []string  `json:"attempt_history,omitempty"`
	CreatedAt      time.Time `json:"created_at"`
	// Git is set when this conflict came from a human-initiated Git operation
	// on the host — a push that had to integrate the remote's work first, or
	// an explicit branch merge — rather than from integrating a verified
	// Wharnex candidate. The two resolve to different places: a candidate's
	// resolution becomes a new verified change, while this one is replayed
	// into the same Git merge and committed as its merge commit.
	Git *GitConflictContext `json:"git,omitempty"`
	// ManualPaths are operator-resolved conflict paths. They are authoritative:
	// a delegated GPT plan may resolve only the remaining paths. ManualPatch is
	// generated against CURRENT and is injected by the backend before execution.
	ManualPaths []string `json:"manual_paths,omitempty"`
	ManualPatch string   `json:"manual_patch,omitempty"`
}

// GitConflictOrigin names what produced a conflict, so a resolver is told
