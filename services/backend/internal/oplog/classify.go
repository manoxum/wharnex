package oplog

import "strings"

// Levels in ascending severity. The set is closed.
const (
	LevelTrace   = "trace"
	LevelDebug   = "debug"
	LevelInfo    = "info"
	LevelSuccess = "success"
	LevelWarning = "warning"
	LevelError   = "error"
)

var levelRank = map[string]int{LevelTrace: 0, LevelDebug: 1, LevelInfo: 2, LevelSuccess: 3, LevelWarning: 4, LevelError: 5}

// ValidLevel reports whether level belongs to the closed set.
func ValidLevel(level string) bool { _, ok := levelRank[level]; return ok }

// LedgerNoiseEventTypes are high-volume progress events whose outcome is
// already carried by a lifecycle event or the execution ledger. They are
// classified as debug and swept from harness_events by age.
var LedgerNoiseEventTypes = []string{
	"command.output", "self_evolution.host_build_output", "git.fetch_completed",
	"self_evolution.status_reconciled", "self_evolution.batch_state", "context.refreshed",
	"context.scanning", "baseline.peer_updated", "integration.branch_cleanup_reconciled",
}

var noise = func() map[string]bool {
	set := map[string]bool{}
	for _, name := range LedgerNoiseEventTypes {
		set[name] = true
	}
	return set
}()

// categoryByComponent groups components into the question an operator asks.
var categoryByComponent = map[string]string{
	"request": "request", "context": "request", "knowledge": "request", "continuation": "request", "manual": "request", "bundle": "request", "artifact": "request",
	"planner": "planning", "plan": "planning", "turn": "planning",
	"policy": "policy", "approval": "policy",
	"execution": "execution", "command": "execution", "verification": "execution", "sandbox": "execution", "workflow": "execution", "interactive": "execution", "debug": "execution",
	"host": "integration", "integration": "integration", "git": "integration", "conflict": "integration", "baseline": "integration",
	"self_evolution": "self_evolution",
	"automation":     "automation", "repair": "automation",
	"chat-agent": "queue", "orchestrator-worker": "queue", "translator": "queue",
	"backend-log": "runtime", "session": "runtime", "project": "runtime", "terminal": "runtime", "frontend-renderer": "ui",
}

// Classify derives component, level and category from an event or channel
// name. It never reads localized prose.
func Classify(event string) (component, level, category string) {
	name := strings.ToLower(strings.TrimSpace(event))
	component = name
	if head, _, found := strings.Cut(name, "."); found {
		component = head
	}
	component = boundedToken(component, 48)
	category = categoryByComponent[component]
	if category == "" && strings.HasPrefix(component, "chatgpt") {
		category = "transport"
	}
	if category == "" {
		category = "other"
	}
	return component, levelForEvent(name), category
}

func levelForEvent(name string) string {
	if noise[name] || strings.HasSuffix(name, "_output") {
		return LevelDebug
	}
	last := name
	if index := strings.LastIndex(name, "."); index >= 0 {
		last = name[index+1:]
	}
	switch {
	case containsAny(last, "failed", "error", "rejected", "aborted", "exhausted", "crash"):
		return LevelError
	case containsAny(last, "blocked", "retained", "degraded", "timeout", "timed_out", "stalled", "abandoned", "cancelled", "warning", "deferred", "busy", "conflict"):
		return LevelWarning
	case containsAny(last, "completed", "succeeded", "applied", "resolved", "persisted", "ready", "confirmed", "accepted", "restarted", "recorded", "attached"):
		return LevelSuccess
	default:
		return LevelInfo
	}
}

func containsAny(value string, needles ...string) bool {
	for _, needle := range needles {
		if strings.Contains(value, needle) {
			return true
		}
	}
	return false
}

func boundedToken(value string, limit int) string {
	var out strings.Builder
	for _, r := range value {
		if out.Len() >= limit {
			break
		}
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			out.WriteRune(r)
		}
	}
	if out.Len() == 0 {
		return "unknown"
	}
	return out.String()
}
