package domain

import "time"

type Session struct {
	ID                  string   `json:"id"`
	ChatID              string   `json:"chat_id,omitempty"`
	ProjectPath         string   `json:"project_path"`
	RelatedProjectPaths []string `json:"related_project_paths,omitempty"`
	// CrossProjectGrant is the authority the current Main Request carries to
	// change projects other than this one, derived from its own `@ref:`
	// directives. It is replaced when a new Main Request is submitted and
	// inherited unchanged by that request's continuations.
	CrossProjectGrant *CrossProjectGrant `json:"cross_project_grant,omitempty"`
	// CrossProjectRanPlanID is the last plan whose cross-project units were
	// dispatched, so an Apply path reached twice for one candidate cannot
	// install the same change in another project twice.
	CrossProjectRanPlanID     string                `json:"cross_project_ran_plan_id,omitempty"`
	ExecutionMode             ExecutionMode         `json:"execution_mode"`
	AutomationMode            AutomationMode        `json:"automation_mode"`
	DebugEnabled              bool                  `json:"debug_enabled,omitempty"`
	DebugApprovedRootID       string                `json:"debug_approved_root_request_id,omitempty"`
	DebugApprovedPlanID       string                `json:"debug_approved_plan_id,omitempty"`
	InteractiveGrant          *InteractiveGrant     `json:"interactive_grant,omitempty"`
	ApprovedChatPlan          *ApprovedChatPlan     `json:"approved_chat_plan,omitempty"`
	ExecutionApprovedRootID   string                `json:"execution_approved_root_request_id,omitempty"`
	ApprovedBoundaryKeys      []string              `json:"approved_execution_boundary_keys,omitempty"`
	EffortLevel               EffortLevel           `json:"effort_level"`
	ReasoningEffort           ReasoningEffort       `json:"reasoning_effort"`
	ContextMode               ContextMode           `json:"context_mode,omitempty"`
	ContextPaths              []string              `json:"context_paths,omitempty"`
	OrchestratorContextPaths  map[string][]string   `json:"orchestrator_context_paths,omitempty"`
	OrchestratorContextRounds map[string]int        `json:"orchestrator_context_rounds,omitempty"`
	ChatTransportMode         ChatTransportMode     `json:"chat_transport_mode"`
	SelfEvolution             bool                  `json:"self_evolution,omitempty"`
	WharnexInstanceID         string                `json:"wharnex_instance_id,omitempty"`
	SelfEvolutionActivation   string                `json:"self_evolution_activation,omitempty"`
	SelfEvolutionImpacts      []string              `json:"self_evolution_impacts,omitempty"`
	ResolvedEvidenceIDs       map[string]time.Time  `json:"resolved_evidence_ids,omitempty"`
	EvidenceReviewIDs         []string              `json:"evidence_review_ids,omitempty"`
	State                     string                `json:"state"`
	CreatedAt                 time.Time             `json:"created_at"`
	Context                   ContextBundle         `json:"context"`
	Plan                      *ExecutionPlan        `json:"plan,omitempty"`
	PlanControl               *PlanExecutionControl `json:"plan_control,omitempty"`
	Policy                    *PolicyDecision       `json:"policy,omitempty"`
	LastExecution             *ExecutionResult      `json:"last_execution,omitempty"`
	PendingHostChanges        []PendingHostChange   `json:"pending_host_changes,omitempty"`
	LastAppliedChanges        []PendingHostChange   `json:"last_applied_changes,omitempty"`
	LastRevertedChanges       []PendingHostChange   `json:"last_reverted_changes,omitempty"`
	LastHostCommands          []CommandResult       `json:"last_host_commands,omitempty"`
	LastHostAppliedAt         time.Time             `json:"last_host_applied_at,omitempty"`
	LastVersionBefore         string                `json:"last_version_before,omitempty"`
	LastVersionAfter          string                `json:"last_version_after,omitempty"`
	LastProviderResponseID    string                `json:"last_provider_response_id,omitempty"`
	LastRequestID             string                `json:"last_request_id,omitempty"`
	PendingManualRequestIDs   []string              `json:"pending_manual_request_ids,omitempty"`
	LastManualPrompt          string                `json:"last_manual_prompt,omitempty"`
	// PendingKnowledgeReviewRequestID marks an in-flight post-apply
	// knowledge_review round. Deliberately independent of State: the apply
	// that triggered this round already succeeded and State already
	// reflects that (applied/restart_pending/...); this field must never be
	// folded into State, or the session would need to "restore" its real
	// state once the review round resolves, which is unnecessary risk for
	// what is a best-effort side round.
	PendingKnowledgeReviewRequestID string `json:"pending_knowledge_review_request_id,omitempty"`
	// KnowledgeSharingEnabled is per-chat. nil is treated as true so sessions
	// persisted before v2 start in the safe/default sharing-on state.
	KnowledgeSharingEnabled            *bool                      `json:"knowledge_sharing_enabled,omitempty"`
	KnowledgeLastSeenRevision          int64                      `json:"knowledge_last_seen_revision,omitempty"`
	PendingKnowledgeRootRequestID      string                     `json:"-"`
	PendingKnowledgeCandidateRequestID string                     `json:"-"`
	PendingKnowledgeCandidate          *ProjectKnowledgeCandidate `json:"-"`
	PendingKnowledgeSummary            string                     `json:"-"`
	// AttemptLedger is the session-scoped attempt state of the Main Request
	// currently in flight (harness.attempts/v1). It is reset when a new Main
	// Request starts and discarded at that request's terminal boundary: its
	// durable residue belongs in the knowledge catalog, which the planner
	// consolidates from this ledger before the terminal response.
	AttemptLedger *AttemptLedger `json:"attempt_ledger,omitempty"`
	// RequestContextDeltas records, per request id, the divergence report that
	// request was sent. Server-only: every transport must materialize the same
	// report the prompt described, and a report is meaningless once its
	// request is gone.
	RequestContextDeltas   map[string]ContextDelta `json:"-"`
	LastMainRequestSummary string                  `json:"last_main_request_summary,omitempty"`
	LastBundle             *ExecutionBundleInfo    `json:"last_bundle,omitempty"`
	LastTurn               *AgentTurn              `json:"last_turn,omitempty"`
	RepairAttempt          int                     `json:"repair_attempt,omitempty"`
	AutomationAttempt      int                     `json:"automation_attempt,omitempty"`
	ImprovementAttempt     int                     `json:"improvement_attempt,omitempty"`
	RepairParentPlanID     string                  `json:"repair_parent_plan_id,omitempty"`
	// ConflictAttempt counts automatic rounds requesting resolution of the
	// SAME IntegrationConflict.ID (a real Git merge conflict or a ChangeSet
	// replay conflict). Distinct from RepairAttempt, which already measures
	// ordinary patch-repair rounds and is reset when a conflict starts —
	// reusing it here would let a plan that already spent repair rounds
	// arrive at a conflict with fewer automatic attempts left than another
	// plan, for no reason related to the conflict itself. Reset to 0
	// whenever a conflict with a new ID begins.
	ConflictAttempt int    `json:"conflict_attempt,omitempty"`
	LastRepairError string `json:"last_repair_error,omitempty"`
	FailureKind     string `json:"failure_kind,omitempty"`
	WorkflowRound   int    `json:"workflow_round,omitempty"`
	// ContextIncrements counts the Partial context increments among the Main
	// Request's WorkflowRound rounds. They are planner-paced reads, not
	// executed steps, so they never spend the workflow step budget.
	ContextIncrements int               `json:"context_increments,omitempty"`
	LastRequestMode   string            `json:"last_request_mode,omitempty"`
	PlannerInFlight   bool              `json:"planner_in_flight,omitempty"`
	RequestBaselines  map[string]string `json:"request_baselines,omitempty"`
	// RequestBaseCommits records, per request id, the host commit whose tree is
	// exactly what that request's planner context was snapshotted from —
	// anchored in the host repository under refs/wharnex/base/<request_id>.
	// A plan's patch is authored against this tree, so rooting its integration
	// branch here makes the patch apply by construction no matter how far the
	// host has advanced since, and turns real divergence into an ordinary
	// three-way merge instead of a dead-end apply failure.
	RequestBaseCommits     map[string]string `json:"request_base_commits,omitempty"`
	RequestContextArchives map[string]string `json:"-"`
	// RequestSupportArtifacts are bounded, engine-authored files that must
	// accompany one derived request but must never be expanded into its prompt.
	// Keeping them server-only prevents large conflict capsules from crossing
	// the Desktop's 1 MiB prompt boundary while the normal request ZIP remains
	// the single authoritative transport.
	RequestSupportArtifacts map[string][]RequestSupportArtifact `json:"-"`
	RequestKnowledge        map[string]RequestKnowledgeSnapshot `json:"-"`
	BaselineFileSnapshots   map[string]map[string]string        `json:"baseline_file_snapshots,omitempty"`
	BaselineNotices         []BaselineNotice                    `json:"baseline_notices,omitempty"`
	ProjectRevisions        []ProjectRevision                   `json:"project_revisions,omitempty"`
	IntegrationConflict     *ConflictResolution                 `json:"integration_conflict,omitempty"`
	Artifacts               []ArtifactRecord                    `json:"artifacts,omitempty"`
	InterruptedExecution    *InterruptedExecution               `json:"interrupted_execution,omitempty"`
	RemoteRecoveryAttempt   int                                 `json:"remote_recovery_attempt,omitempty"`
	RequestLineages         map[string]RequestLineage           `json:"request_lineages,omitempty"`
	// ArchivedAt/CompactedAt/ArchivePackage implement the passive chat-archive
	// lifecycle (see ADR-0031). Pointers, not bare time.Time: encoding/json's
	// omitempty is a no-op on a zero struct value, and callers need a clean
	// null to mean "not archived".
	ArchivedAt     *time.Time            `json:"archived_at,omitempty"`
	CompactedAt    *time.Time            `json:"compacted_at,omitempty"`
	ArchivePackage *ArchivePackageRecord `json:"archive_package,omitempty"`
}
