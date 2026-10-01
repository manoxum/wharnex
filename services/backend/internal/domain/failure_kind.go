package domain

// FailureKind is Wharnex's own closed-set classification of a terminal
// session failure. It is always derived by Wharnex itself — from a sandbox
// error via errors.Is, or from a planner turn's structured outcome — and
// never copied verbatim from planner-supplied text. Consumers (including the
// frontend) MUST key recovery affordances on this field, never on error
// message substrings: message text is free-form prose that can be rephrased
// or translated, but this field is a value Wharnex itself commits to.
const (
	// FailureKindOfflineGoModuleCache marks a failure caused by the host Go
	// module cache being unable to satisfy the project's build list while
	// GOPROXY=off. It is recoverable via a human-approved, narrowly scoped
	// network grant (see RetryDependencyNetwork).
	FailureKindOfflineGoModuleCache = "offline_go_module_cache"

	// FailureKindHostBuildToolchain marks a self-evolution host build that
	// failed because the host's own toolchain (e.g. the Node.js runtime
	// running `make build-stage`) cannot satisfy a pinned dependency's
	// engine requirement (e.g. Electron requiring a newer Node than the
	// host has installed). Unlike FailureKindOfflineGoModuleCache, there is
	// no Wharnex-grantable recovery: no source patch can change the host's
	// installed runtime, so this must never consume a ChatGPT repair round.
	FailureKindHostBuildToolchain = "host_build_toolchain_mismatch"

	// FailureKindHostDependencyState marks a host-only dependency installation
	// defect discovered after the same candidate already verified in Protected
	// execution (for example, a missing platform-specific npm optional/native
	// binding under node_modules). Replanning source cannot repair host package
	// installation state, so this must stop automatic GPT repair/retry loops.
	FailureKindHostDependencyState = "host_dependency_state"

	// FailureKindHostBuildDependencyNetwork marks a host build that failed
	// while fetching dependencies over the network — a DNS answer that never
	// came, a refused or reset connection, a registry timeout. The candidate
	// is not implicated: the same build succeeds unchanged once the network
	// answers, so a planner round spent rewriting source is spent on the one
	// thing that cannot be the cause. Retrying the Apply is the recovery.
	FailureKindHostBuildDependencyNetwork = "host_build_dependency_network"

	// FailureKindSandboxDependencyAcquisition marks a Protected dependency
	// hydration attempt that could not obtain deterministic package payloads.
	// Source repair cannot make a registry/DNS path available.
	FailureKindSandboxDependencyAcquisition = "sandbox_dependency_acquisition"

	// FailureKindSandboxToolUnavailable marks a verification executable that
	// was not runnable in the published Protected image. It is infrastructure,
	// never equivalent to a pre-existing project test failure.
	FailureKindSandboxToolUnavailable = "sandbox_tool_unavailable"

	// FailureKindSelfEvolutionBusy marks a local coordination block: another
	// self-evolution transaction currently owns the activation lock. The
	// verified candidate is retained and can be applied after that transaction
	// clears; asking the model for another source patch cannot resolve it.
	FailureKindSelfEvolutionBusy = "self_evolution_transaction_busy"

	// FailureKindSelfEvolutionMetadata marks a retained self-evolution batch
	// whose transaction.json identity disagrees with the runtime status that
	// references its directory. This is local recovery state, not a source
	// defect, so a new planner repair round cannot resolve it.
	FailureKindSelfEvolutionMetadata = "self_evolution_transaction_metadata_mismatch"

	// FailureKindStaleHostBaseline marks a retained legacy candidate that could
	// not be safely replayed/reverified on the current host baseline. Wharnex
	// must preserve the candidate for explicit retry/review rather than spend a
	// ChatGPT repair round on baseline metadata.
	FailureKindStaleHostBaseline = "stale_host_baseline"

	// FailureKindHostIntegrationRace marks repeated compare-and-swap races while
	// committing an already verified ChangeSet. This is host concurrency, not a
	// model/source defect; the candidate remains safe to retry.
	FailureKindHostIntegrationRace = "host_integration_race"

	// FailureKindSandboxPreparationTimeout marks a Protected command whose
	// command budget expired while Wharnex was preparing the isolated runner
	// (for example while copying project-local node_modules). The source patch
	// has not executed yet, so replanning source cannot resolve this failure.
	FailureKindSandboxPreparationTimeout = "sandbox_preparation_timeout"

	// FailureKindExecutionCanceled marks a sandbox/host command interrupted by
	// cancellation of the owning request context. It is a transport/lifecycle
	// interruption, not evidence that the model-generated source is defective.
	FailureKindExecutionCanceled = "execution_context_canceled"

	// FailureKindRemoteInputTransport marks a terminal failure to obtain or
	// validate the remote ChatGPT result. The project source did not fail, so
	// recovery is a fresh transport request rather than a source repair turn.
	FailureKindRemoteInputTransport = "remote_input_transport"

	// FailureKindSubmoduleWrite marks a response bundle that attempted to write
	// files owned by a registered Git submodule while the open Wharnex project
	// is the superproject. The source change may be valid, but it belongs to a
	// different repository, so retrying or repairing the same request against
	// the superproject cannot succeed.
	FailureKindSubmoduleWrite = "submodule_write"

	// FailureKindSandboxResourceExhausted marks a Protected command that
	// failed because the machine ran out of disk, memory or file descriptors
	// mid-run — observed as a linker reporting "no space left on device"
	// during a race-enabled test build. The generated source is not implicated
	// and rewriting it cannot help, so this must never spend a repair round;
	// recovery is freeing host resources (or narrowing the verification set)
	// and retrying the retained candidate.
	FailureKindSandboxResourceExhausted = "sandbox_resource_exhausted"

	// FailureKindArtifactStorageFull marks a response bundle that validated
	// but could not be archived because the local object store rejected the
	// write for lack of space. Archival is bookkeeping, never a reason to
	// discard a verified result, so this classification exists to make the
	// operator-facing remedy explicit rather than to fail the request.
	FailureKindArtifactStorageFull = "artifact_storage_full"

	// FailureKindHostWorkingStateBlocked marks a verified candidate Wharnex
	// deliberately refused to integrate because the host working tree is in a
	// state where committing on top of it would damage the operator's own
	// uncommitted work: an unfinished merge/rebase, unresolved conflict paths,
	// or a change that moves the recorded commit of a submodule holding
	// uncommitted content.
	//
	// It is emphatically not a source defect, so it never consumes a repair
	// round. The candidate is retained and Apply succeeds unchanged once the
	// operator clears the condition the failure names.
	FailureKindHostWorkingStateBlocked = "host_working_state_blocked"

	// FailureKindPlannerGuidanceRequired marks a planner outcome that explicitly
	// declared retryable=false without mapping to a dedicated local recovery.
	// Repeating the same request would loop, but an operator may provide new
	// evidence or guidance and deliberately start a materially different round.
	FailureKindPlannerGuidanceRequired = "planner_guidance_required"

	// FailureKindConflictCapsuleStale marks a recovery round for an active Git
	// conflict resolution thread that reached the planner without a refreshed
	// harness.conflict/v1 capsule for the paths it still owes a resolution for.
	// This is never an operator-guidance gap: the capsule's BASE/CURRENT/RESULT
	// content is already known locally (IntegrationConflict.PathSources plus
	// the live host HEAD), so retrying identically — with or without operator
	// text — reproduces the same rejection every round. Its dedicated recovery,
	// RenewConflictCapsule, rebuilds and resends that exact capsule.
	FailureKindConflictCapsuleStale = "conflict_capsule_stale"

	// FailureKindIntegrationActionRequired marks a planner outcome proving that
	// only Wharnex's own integration layer can make progress: a pending
	// candidate fails to replay before any plan runs, or a capsule no longer
	// matches the host. No planner patch can reach that point, and no operator
	// guidance is needed either — the engine re-applies what the host now
	// accepts or rebuilds the capsule from the live host.
	FailureKindIntegrationActionRequired = "integration_action_required"
)
