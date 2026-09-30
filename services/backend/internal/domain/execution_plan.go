package domain

import "time"

type VersionIncrement struct {
	Component string `json:"component"`
	Amount    int    `json:"amount"`
}

const (
	VersionComponentMajor  = "major"
	VersionComponentMedium = "medium"
	VersionComponentMinor  = "minor"
	VersionComponentPatch  = "patch"
)

func ValidVersionComponent(component string) bool {
	switch component {
	case VersionComponentMajor, VersionComponentMedium, VersionComponentMinor, VersionComponentPatch:
		return true
	default:
		return false
	}
}

type ExecutionPlan struct {
	Protocol          string   `json:"protocol"`
	BaseContextSHA256 string   `json:"base_context_sha256,omitempty"`
	ImpactFiles       []string `json:"impact_files,omitempty"`
	ReadFiles         []string `json:"read_files,omitempty"`
	BarrierFiles      []string `json:"barrier_files,omitempty"`
	PlanID            string   `json:"plan_id"`
	RequestID         string   `json:"request_id"`
	Status            string   `json:"status"`
	Summary           string   `json:"summary"`
	// Document is the human-facing execution contract. Unlike Summary (one
	// sentence), it explains the approach, risks and verification before the
	// operator consents.
	Document         string            `json:"document,omitempty"`
	Dependencies     []PlanDependency  `json:"dependencies,omitempty"`
	SystemTools      []PlanSystemTool  `json:"system_tools,omitempty"`
	ApprovedChatPlan *ApprovedChatPlan `json:"approved_chat_plan,omitempty"`
	Debug            *DebugSpec        `json:"debug,omitempty"`
	VersionIncrement *VersionIncrement `json:"version_increment,omitempty"`
	// CommitMessage is the planner-authored Git commit message for a
	// `change` plan's patch, used verbatim (after sanitization) as the
	// commit Wharnex makes on the sandbox's own integration branch before
	// merging it into the host — see internal/sandbox/gitintegration.go.
	// Empty for `workflow` plans, which never reach the host.
	CommitMessage    string        `json:"commit_message,omitempty"`
	Risk             string        `json:"risk"`
	RequiresApproval bool          `json:"requires_approval"`
	Operations       []Operation   `json:"operations"`
	Verification     []CommandSpec `json:"verification"`
	// CrossProject carries work for projects other than the one this request
	// belongs to, one self-contained unit per project.
	//
	// It is a list of units rather than a `project` tag on each operation
	// because a change to another project is a whole change to that project:
	// it needs its own commit message, because it becomes that project's Git
	// history, and its own verification, because it is verified in that
	// project's sandbox against that project's tree. Tagging operations would
	// have left both of those with nowhere to live.
	//
	// A unit is admissible only when the request's own prompt granted that
	// project by name (see internal/crossproject and adr/ADR-0053). The primary
	// plan above is unchanged and unaware of this field.
	CrossProject []CrossProjectUnit `json:"cross_project,omitempty"`
}

// DebugSpec turns a workflow plan into a bounded diagnostic probe. Observe is
// the backwards-compatible default. Modify is host-only, approval-gated, and
// still constrained by argv validation plus the Policy Engine.
type DebugSpec struct {
	Protocol    string `json:"protocol"`
	Target      string `json:"target"`
	Access      string `json:"access,omitempty"`
	AutoObserve bool   `json:"auto_observe,omitempty"`
	// Query selects an engine-owned, read-only diagnostic. Unlike a command it
	// never crosses the process boundary and cannot acquire shell/filesystem
	// authority from model-controlled argv. Queries are observe-only.
	Query        string           `json:"query,omitempty"`
	Capabilities []string         `json:"capabilities,omitempty"`
	Scope        InteractiveScope `json:"scope,omitempty"`
	Rationale    string           `json:"rationale"`
}

type InteractiveScope struct {
	Paths               []string `json:"paths,omitempty"`
	Connections         []string `json:"connections,omitempty"`
	LogSources          []string `json:"log_sources,omitempty"`
	Processes           []string `json:"processes,omitempty"`
	Services            []string `json:"services,omitempty"`
	Containers          []string `json:"containers,omitempty"`
	NetworkDestinations []string `json:"network_destinations,omitempty"`
}

type InteractiveGrant struct {
	Protocol       string           `json:"protocol"`
	PolicyRevision string           `json:"policy_revision"`
	RootRequestID  string           `json:"root_request_id"`
	PlanID         string           `json:"plan_id,omitempty"`
	Access         string           `json:"access"`
	Target         string           `json:"target"`
	Capabilities   []string         `json:"capabilities"`
	Scope          InteractiveScope `json:"scope"`
	Digest         string           `json:"digest"`
	OneShot        bool             `json:"one_shot"`
	GrantedAt      time.Time        `json:"granted_at"`
}

func (d DebugSpec) EffectiveAccess() string {
	if d.Access == "" {
		return DebugAccessObserve
	}
	return d.Access
}

// PlanDependency describes project dependency impact plus bounded acquisition
// strategies. It does not itself grant package-manager command authority; the
// engine may only execute acquisition methods it explicitly owns, and the
// Policy Engine remains authoritative for planner-supplied operations.
type PlanDependency struct {
	Scope       string                    `json:"scope"`
	Manager     string                    `json:"manager"`
	Name        string                    `json:"name"`
	Version     string                    `json:"version,omitempty"`
	Action      string                    `json:"action"`
	Reason      string                    `json:"reason"`
	Acquisition []PlanAcquisitionStrategy `json:"acquisition,omitempty"`
}

// PlanAcquisitionStrategy tells the engine and operator how a declared
// prerequisite can be obtained if it is absent. Automatic means Wharnex may
// perform the strategy inside the Protected sandbox; host mutation strategies
// are always approval-gated regardless of planner intent.
type PlanAcquisitionStrategy struct {
	Method    string `json:"method"`
	Manager   string `json:"manager,omitempty"`
	Package   string `json:"package,omitempty"`
	Version   string `json:"version,omitempty"`
	Automatic bool   `json:"automatic"`
	Reason    string `json:"reason"`
}

// PlanSystemTool discloses an OS/runtime prerequisite and how it could be
// acquired if absent. Lifetime is required when a host mutation installs,
// updates or configures a tool so the operator can distinguish disposable
// tooling from durable host state; host acquisition never becomes automatic
// merely because the planner declared a strategy.
type PlanSystemTool struct {
	Target      string                    `json:"target"`
	Name        string                    `json:"name"`
	Action      string                    `json:"action"`
	Lifetime    string                    `json:"lifetime,omitempty"`
	Reason      string                    `json:"reason"`
	Acquisition []PlanAcquisitionStrategy `json:"acquisition,omitempty"`
}

// ApprovedChatPlan binds an executable response to the exact planning-only
// proposal the operator approved earlier in the same Main Request.
type ApprovedChatPlan struct {
	Protocol  string `json:"protocol"`
	RequestID string `json:"request_id"`
	SHA256    string `json:"sha256"`
	Document  string `json:"document"`
}

// CrossProjectUnit is a complete change for one granted referenced project.
//
// It is deliberately shaped like the executable half of a plan: the same
// operations, the same verification commands, and the same mandatory commit
// message a change owes the history it will become. It is executed as a derived
// request on that project — its own Protected sandbox, its own verification,
// its own Git-native host integration — because that is the only authority that
// may write to a project, and it does not change when the patch arrived through
// another project's chat.
