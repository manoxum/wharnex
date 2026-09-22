package domain

type ExecutionMode string

const (
	ExecutionModeProtected   ExecutionMode = "protected"
	ExecutionModeUnprotected ExecutionMode = "unprotected"
	ExecutionModeFull        ExecutionMode = "full"
)

func ValidExecutionMode(mode ExecutionMode) bool {
	return mode == ExecutionModeProtected || mode == ExecutionModeUnprotected || mode == ExecutionModeFull
}

func ExecutionModeTargetsHost(mode ExecutionMode) bool {
	return mode == ExecutionModeUnprotected || mode == ExecutionModeFull
}

type PolicyDecision struct {
	Allowed          bool                `json:"allowed"`
	RequiresApproval bool                `json:"requires_approval"`
	Risk             string              `json:"risk"`
	Reasons          []string            `json:"reasons"`
	ApprovalItems    []ExecutionApproval `json:"approval_items,omitempty"`
}

// ExecutionApproval is operator-facing policy metadata. It is intentionally
// descriptive rather than executable: the engine still runs only the exact
// validated plan command. BypassInFull marks command-policy approvals that the
// explicit Full execution mode may waive; sudo and non-command host/system trust
// boundaries never set it.
type ExecutionApproval struct {
	Kind                 string   `json:"kind"`
	Argv                 []string `json:"argv,omitempty"`
	Rationale            string   `json:"rationale,omitempty"`
	Effect               string   `json:"effect"`
	HostImpact           string   `json:"host_impact"`
	RequiresSudoPassword bool     `json:"requires_sudo_password,omitempty"`
	BypassInFull         bool     `json:"bypass_in_full,omitempty"`
}
