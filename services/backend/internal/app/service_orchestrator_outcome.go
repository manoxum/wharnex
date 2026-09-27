package app

// An Agent may be verified before Protected host integration has finished.
// Dependents can run only after that integration has succeeded.
func orchestratorAgentOutcome(state string) string {
	switch state {
	case "applied", "restart_pending":
		return "review"
	case "failed", "blocked", "cancelled":
		return "failed"
	default:
		return ""
	}
}
