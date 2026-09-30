package domain

const ProtocolV1 = "harness.execution/v1"
const ProtocolV2 = "harness.execution/v2"
const TurnProtocolV1 = "harness.turn/v1"
const DebugProtocolV1 = "harness.debug/v1"

// InteractiveProtocolV1 is the public successor to the legacy debug label.
// DebugProtocolV1 remains readable for durable/in-flight compatibility.
const InteractiveProtocolV1 = "harness.interactive/v1"
const InteractiveProtocolV2 = "harness.interactive/v2"
const InteractivePolicyRevisionV2 = "interactive-v2-policy/1"
const InterviewProtocolV1 = "harness.interview/v1"

const DebugQueryProjectExecutionSummary = "project_execution_summary"

const (
	DebugAccessObserve = "observe"
	DebugAccessModify  = "modify"
)

const (
	InteractiveCapabilityCommand    = "command"
	InteractiveCapabilityShell      = "shell"
	InteractiveCapabilitySQL        = "sql"
	InteractiveCapabilityLogs       = "logs"
	InteractiveCapabilityFilesystem = "filesystem"
	InteractiveCapabilityProcess    = "process"
	InteractiveCapabilityNetwork    = "network"
	InteractiveCapabilityContainer  = "container"
	InteractiveCapabilityService    = "service"
)

func ValidInteractiveCapability(value string) bool {
	switch value {
	case InteractiveCapabilityCommand, InteractiveCapabilityShell, InteractiveCapabilitySQL, InteractiveCapabilityLogs, InteractiveCapabilityFilesystem, InteractiveCapabilityProcess, InteractiveCapabilityNetwork, InteractiveCapabilityContainer, InteractiveCapabilityService:
		return true
	default:
		return false
	}
}

const (
	ToolLifetimeTemporary  = "temporary"
	ToolLifetimePersistent = "persistent"
)

type TurnKind string

const (
	TurnKindAnswer         TurnKind = "answer"
	TurnKindClarification  TurnKind = "clarification"
	TurnKindInvestigation  TurnKind = "investigation"
	TurnKindPlan           TurnKind = "plan"
	TurnKindWorkflow       TurnKind = "workflow"
	TurnKindContextRequest TurnKind = "context_request"
	TurnKindChange         TurnKind = "change"
	TurnKindBlocked        TurnKind = "blocked"
)

func ValidTurnKind(kind TurnKind) bool {
	switch kind {
	case TurnKindAnswer, TurnKindClarification, TurnKindInvestigation, TurnKindPlan, TurnKindWorkflow, TurnKindContextRequest, TurnKindChange, TurnKindBlocked:
		return true
	default:
		return false
	}
}

type AgentTurn struct {
	Protocol            string       `json:"protocol"`
	RequestID           string       `json:"request_id"`
	Kind                TurnKind     `json:"kind"`
	ChatTitle           string       `json:"chat_title,omitempty"`
	Message             string       `json:"message"`
	Outcome             *TurnOutcome `json:"outcome"`
	ResolvedEvidenceIDs []string     `json:"resolved_evidence_ids,omitempty"`
	Interview           *Interview   `json:"interview,omitempty"`
	ContextPaths        []string     `json:"context_paths,omitempty"`
}

// Interview is a structured clarification. It is data for a human decision,
// never executable instruction. A reply returns through the ordinary composer
// so the user retains control over what is submitted to the provider.
type Interview struct {
	Protocol  string              `json:"protocol"`
	Questions []InterviewQuestion `json:"questions"`
}

type InterviewQuestion struct {
	ID            string            `json:"id"`
	Prompt        string            `json:"prompt"`
	AllowMultiple bool              `json:"allow_multiple,omitempty"`
	Options       []InterviewOption `json:"options"`
}

type InterviewOption struct {
	ID    string `json:"id"`
	Label string `json:"label"`
}

// TurnOutcome describes whether the planner completed its response. It never
// claims host execution, which remains an authoritative Wharnex result.
type TurnOutcome struct {
	Status     string `json:"status"`
	ReasonCode string `json:"reason_code,omitempty"`
	Message    string `json:"message,omitempty"`
	Retryable  bool   `json:"retryable"`
}

const (
	TurnOutcomeCompleted = "completed"
	TurnOutcomeFailed    = "failed"
	TurnOutcomePartial   = "partial"
)
