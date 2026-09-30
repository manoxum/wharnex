package selfevolution

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
)

var (
	ErrBusy                            = errors.New("another Wharnex self-evolution transaction is already active")
	ErrSelfEvolutionInProgress         = errors.New("a Wharnex self-evolution restart is already in progress")
	errTransactionDirectoryUnavailable = errors.New("self-evolution transaction directory is unavailable")
	// ErrHostBuildToolchainMismatch marks a BuildHost failure that no source
	// patch can fix: the host's installed toolchain (observed: Node.js) is
	// older than a pinned dependency's engine requirement (observed:
	// Electron requiring a newer Node than `make build-stage` found on the
	// host). Callers must never route a cause matching this sentinel into
	// the ChatGPT repair loop.
	ErrHostBuildToolchainMismatch = errors.New("self-evolution host build failed due to a host toolchain mismatch, not a source defect")
	// ErrRollbackUnsafe marks a Transaction.Rollback refusal: the host's real
	// Git HEAD advanced past this transaction's own pre-transaction baseline
	// with changes overlapping the exact paths Rollback would otherwise
	// silently overwrite by raw file copy. See Rollback's doc comment.
	ErrRollbackUnsafe = errors.New("self-evolution rollback refused: host git history advanced with overlapping unrelated changes since this transaction's baseline")
	runtimeInstanceID = makeInstanceID()
)

// BlockedTransactionError explains a refusal to start self-evolution because an
// earlier transaction is parked in a fail-closed phase.
//
// The bare ErrBusy it replaces was true and useless. A fail-closed phase such
// as rollback_failed deliberately holds the global batch lock so an operator
// can recover by hand — but nothing told them the phase, which transaction, why
// it stopped, or what action releases it, and no endpoint offered to release
// it. The result was a permanent deadlock: every later self-evolution refused,
// with a message that named no remedy, for a lock only a human can clear.
//
// It reports as ErrBusy to errors.Is, so every existing caller keeps its
// behavior while gaining the detail.
type BlockedTransactionError struct {
	Phase       string
	Transaction string
	PlanID      string
	Detail      string
	Remedy      string
}

func (e *BlockedTransactionError) Error() string {
	message := fmt.Sprintf("%s: transaction %s is held in phase %q", ErrBusy, e.Transaction, e.Phase)
	if e.PlanID != "" {
		message += fmt.Sprintf(" from plan %s", e.PlanID)
	}
	if e.Detail != "" {
		message += ": " + e.Detail
	}
	if e.Remedy != "" {
		message += "; " + e.Remedy
	}
	return message
}

// Is keeps errors.Is(err, ErrBusy) true for every pre-existing caller.
func (e *BlockedTransactionError) Is(target error) bool { return target == ErrBusy }

// hostToolchainMismatchMarkers are literal substrings observed in real
// `make build-stage` output when a pinned dependency's install/postinstall
// step fails because the host's own runtime is too old to run it — not
// because of anything in the patched source. Kept narrow and literal
// (rather than a broad EBADENGINE match, which is only ever a warning and
// fires on every build): a false positive here would silently swallow a
// genuine, repairable source defect.
var hostToolchainMismatchMarkers = []string{
	"ERR_REQUIRE_ESM",
	"Electron failed to install correctly",
	// `make build-stage` runs inside Alpine as well as on util-linux hosts.
	// An unsupported flock flag is a lifecycle/runtime incompatibility; no
	// change to the candidate source can teach the installed binary that flag.
	"flock: unrecognized option",
	"flock: invalid option",
	"flock: illegal option",
}

func IsHostToolchainMismatch(output string) bool {
	for _, marker := range hostToolchainMismatchMarkers {
		if strings.Contains(output, marker) {
			return true
		}
	}
	return false
}

func makeInstanceID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

type Manager struct {
	root string
}

type Status struct {
	Phase       string
	SessionID   string
	PlanID      string
	Transaction string
	UpdatedAt   string
	Detail      string
}

type Transaction struct {
	ID             string
	Root           string
	Dir            string
	Worker         string
	RollbackScript string
	// PreTransactionSHA is the host's real Git HEAD captured when this
	// transaction's source backups were taken (empty when the host has no
	// Git repository, or for a transaction created before this field
	// existed). See Rollback.
	PreTransactionSHA string
	// Extended distinguishes a newly captured rollback batch from a stage that
	// joined an already restart-pending batch. A pre-mutation failure in the
	// latter must release only the stage lock; finalizing it would destroy the
	// prior batch's still-needed restart/rollback evidence.
	Extended           bool
	ExtensionAddedPlan bool
	PreviousPending    PendingPlan
	ActivationImpacts  []string
	lockPath           string
	stageLockPath      string
}

type PendingPlan struct {
	SessionID string `json:"session_id"`
	PlanID    string `json:"plan_id"`
}
