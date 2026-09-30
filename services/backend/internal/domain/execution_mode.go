package domain

type AutomationMode string

const (
	AutomationModeManual      AutomationMode = "manual"
	AutomationModeAuto        AutomationMode = "auto"
	AutomationModeAutoApprove AutomationMode = "auto_approve"
)

func ValidAutomationMode(mode AutomationMode) bool {
	return mode == AutomationModeManual || mode == AutomationModeAuto || mode == AutomationModeAutoApprove
}

func AutomationModeIsAutomatic(mode AutomationMode) bool {
	return mode == AutomationModeAuto || mode == AutomationModeAutoApprove
}

func AutomationModeApproves(mode AutomationMode) bool {
	return mode == AutomationModeAutoApprove
}

type EffortLevel string

const (
	EffortLevelLow       EffortLevel = "low"
	EffortLevelMedium    EffortLevel = "medium"
	EffortLevelHigh      EffortLevel = "high"
	EffortLevelExtraHigh EffortLevel = "extra_high"
	EffortLevelMax       EffortLevel = "max"
	EffortLevelUltra     EffortLevel = "ultra"
	EffortLevelLoop      EffortLevel = "loop"
)

func ValidEffortLevel(level EffortLevel) bool {
	switch level {
	case EffortLevelLow, EffortLevelMedium, EffortLevelHigh, EffortLevelExtraHigh, EffortLevelMax, EffortLevelUltra, EffortLevelLoop:
		return true
	default:
		return false
	}
}

// ReasoningEffort controls the provider's per-turn reasoning depth. It is
// deliberately independent from EffortLevel, which bounds how many autonomous
// attempts Wharnex may spend across the whole Main Request.
type ReasoningEffort string

const (
	ReasoningEffortInstant ReasoningEffort = "instant"
	ReasoningEffortMedium  ReasoningEffort = "medium"
	ReasoningEffortHigh    ReasoningEffort = "high"
)

func ValidReasoningEffort(effort ReasoningEffort) bool {
	switch effort {
	case ReasoningEffortInstant, ReasoningEffortMedium, ReasoningEffortHigh:
		return true
	default:
		return false
	}
}

// ChatTransportMode controls whether Wharnex Desktop drives the embedded
// ChatGPT conversation's DOM directly (Scraper — composer fill, submit, and
// download interception, as it always has) or never touches that DOM at all
// (Manual — the prompt is only ever shown to the human to copy/paste, and a
// completed response bundle is only ever imported by the human uploading
// it). Independent of AutomationMode: automatic execution + Manual is a valid, meaningful
// combination — Wharnex still decides execute/apply automatically, only
// the conversation transport itself is human-driven.
type ChatTransportMode string

const (
	ChatTransportModeScraper ChatTransportMode = "scraper"
	ChatTransportModeManual  ChatTransportMode = "manual"
)

func ValidChatTransportMode(mode ChatTransportMode) bool {
	return mode == ChatTransportModeScraper || mode == ChatTransportModeManual
}

type TerminalTarget string

const (
	TerminalTargetSandbox TerminalTarget = "sandbox"
	TerminalTargetHost    TerminalTarget = "host"
)

func ValidTerminalTarget(target TerminalTarget) bool {
	return target == TerminalTargetSandbox || target == TerminalTargetHost
}

type CommandSpec struct {
	Argv              []string `json:"argv"`
	Cwd               string   `json:"cwd"`
	TimeoutSeconds    int      `json:"timeout_seconds"`
	Network           bool     `json:"network"`
	ExpectedExitCodes []int    `json:"expected_exit_codes"`
	// Rationale is a concise user-facing explanation of why the planner chose
	// this command and what evidence or effect it is expected to produce. It is
	// deliberately not private chain-of-thought.
	Rationale string `json:"rationale,omitempty"`
	// EnvAllowlist is executor-owned metadata and is never planner-authored.
	// A non-nil value constrains child-process inheritance to these names.
	EnvAllowlist []string `json:"-"`
	// Stdin is executor-owned ephemeral input. It is deliberately excluded from
	// every JSON/audit representation so short-lived credentials (for example a
	// sudo password entered by the operator) can reach the child process without
	// becoming durable session or event data.
	Stdin []byte `json:"-"`
}

type Operation struct {
	Type  string `json:"type"`
	Patch string `json:"patch"`
	// Rationale carries the same concise operator-facing purpose for typed
	// interactive operations that are not represented directly by CommandSpec.
	Rationale  string                     `json:"rationale,omitempty"`
	Command    CommandSpec                `json:"command"`
	Shell      *InteractiveShellSpec      `json:"shell,omitempty"`
	SQL        *InteractiveSQLSpec        `json:"sql,omitempty"`
	Logs       *InteractiveLogsSpec       `json:"logs,omitempty"`
	Filesystem *InteractiveFilesystemSpec `json:"filesystem,omitempty"`
	Process    *InteractiveProcessSpec    `json:"process,omitempty"`
	Network    *InteractiveNetworkSpec    `json:"network,omitempty"`
	Container  *InteractiveContainerSpec  `json:"container,omitempty"`
	Service    *InteractiveServiceSpec    `json:"service,omitempty"`
}

type InteractiveShellSpec struct {
	Script         string   `json:"script"`
	Shell          string   `json:"shell"`
	Cwd            string   `json:"cwd"`
	TimeoutSeconds int      `json:"timeout_seconds"`
	Network        bool     `json:"network"`
	EnvAllowlist   []string `json:"env_allowlist,omitempty"`
}

type InteractiveSQLSpec struct {
	ConnectionID   string `json:"connection_id"`
	Statement      string `json:"statement"`
	Mode           string `json:"mode"`
	TimeoutSeconds int    `json:"timeout_seconds"`
	MaxRows        int    `json:"max_rows"`
}

type InteractiveLogsSpec struct {
	Source    string `json:"source"`
	Path      string `json:"path,omitempty"`
	Unit      string `json:"unit,omitempty"`
	Container string `json:"container,omitempty"`
	Since     string `json:"since,omitempty"`
	Until     string `json:"until,omitempty"`
	Limit     int    `json:"limit"`
	Filter    string `json:"filter,omitempty"`
}

type InteractiveFilesystemSpec struct {
	Action   string `json:"action"`
	Path     string `json:"path"`
	Content  string `json:"content,omitempty"`
	MaxBytes int    `json:"max_bytes,omitempty"`
}

type InteractiveProcessSpec struct {
	Action string `json:"action"`
	PID    int    `json:"pid,omitempty"`
	Signal string `json:"signal,omitempty"`
}

type InteractiveNetworkSpec struct {
	Action         string `json:"action"`
	Address        string `json:"address"`
	TimeoutSeconds int    `json:"timeout_seconds"`
}

type InteractiveContainerSpec struct {
	Action         string   `json:"action"`
	Name           string   `json:"name"`
	Argv           []string `json:"argv,omitempty"`
	Tail           int      `json:"tail,omitempty"`
	TimeoutSeconds int      `json:"timeout_seconds,omitempty"`
}

type InteractiveServiceSpec struct {
	Action string `json:"action"`
	Name   string `json:"name"`
}
