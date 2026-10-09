package automationhold

import "time"

// Effective states of one task type, as every policy surface shows them.
const (
	StateActive    = "active"
	StateSuspended = "suspended"
	StateCooldown  = "cooldown"
)

// TaskKind is one browser task type and the facts that decide which
// cooldowns reach it.
type TaskKind struct {
	Type    string
	Pool    string
	Uploads bool
}

// Cooldown is an automatic, evidence-raised pause that reaches a task type.
type Cooldown struct {
	Kind   string     `json:"kind"` // rate_limit | upload_limit
	Until  *time.Time `json:"until,omitempty"`
	Reason string     `json:"reason"`
}

// TaskPolicy is the effective state of one task type. A manual or default
// suspension outranks a cooldown in State; Cooldowns still lists every
// automatic pause so releasing the suspension never hides one.
type TaskPolicy struct {
	Type      string     `json:"type"`
	Pool      string     `json:"pool"`
	Uploads   bool       `json:"uploads"`
	State     string     `json:"state"`
	Hold      Hold       `json:"hold"`
	Cooldowns []Cooldown `json:"cooldowns"`
}

// ProviderPause is the durable Worker rate-limit cooldown.
type ProviderPause struct {
	Paused bool
	Until  *time.Time
	Reason string
}

// TaskPolicies derives the effective state of every task type at now.
func TaskPolicies(kinds []TaskKind, holds map[string]Hold, provider ProviderPause, upload Hold, now time.Time) []TaskPolicy {
	rateLimited := provider.Paused && (provider.Until == nil || provider.Until.After(now))
	uploadLimited := upload.InForce(now)
	policies := make([]TaskPolicy, 0, len(kinds))
	for _, kind := range kinds {
		policy := TaskPolicy{Type: kind.Type, Pool: kind.Pool, Uploads: kind.Uploads, Hold: holds[kind.Type], Cooldowns: []Cooldown{}, State: StateActive}
		// The automatic rate-limit pause reaches only the persistent Worker
		// pool; Supervisors and ephemeral Workers keep operating through it.
		if rateLimited && kind.Pool == "worker" {
			policy.Cooldowns = append(policy.Cooldowns, Cooldown{Kind: "rate_limit", Until: provider.Until, Reason: provider.Reason})
		}
		if uploadLimited && kind.Uploads {
			policy.Cooldowns = append(policy.Cooldowns, Cooldown{Kind: "upload_limit", Until: upload.Until, Reason: upload.Reason})
		}
		switch {
		case policy.Hold.InForce(now):
			policy.State = StateSuspended
		case len(policy.Cooldowns) > 0:
			policy.State = StateCooldown
		}
		policies = append(policies, policy)
	}
	return policies
}
