package sessionvault

import "time"

// PlanInput describes one chain about to run: its prerequisites in execution
// order and what a reusable snapshot must match.
type PlanInput struct {
	EnvironmentID string
	Origin        string
	// Order lists the prerequisites of the selected test, in execution order.
	Order []string
	// Profiles maps each prerequisite to the profile its session runs under.
	Profiles map[string]string
	// Digests maps every catalog test to its current definition digest.
	Digests map[string]string
	// MustRun names prerequisites the operator selected explicitly; a restore
	// point may never skip them.
	MustRun   map[string]bool
	Snapshots []Snapshot
	Now       time.Time
}

// Plan returns the index in Order of the deepest prerequisite whose snapshot
// can stand in for running Order[0..index], and that snapshot. It returns -1
// when the whole chain must run.
func Plan(input PlanInput) (int, Snapshot) {
	byTest := map[string]Snapshot{}
	for _, snapshot := range input.Snapshots {
		if current, ok := byTest[snapshot.TestID]; !ok || snapshot.CapturedAt.After(current.CapturedAt) {
			byTest[snapshot.TestID] = snapshot
		}
	}
	limit := len(input.Order)
	for i, id := range input.Order {
		if input.MustRun[id] {
			limit = i
			break
		}
	}
	for i := limit - 1; i >= 0; i-- {
		snapshot, ok := byTest[input.Order[i]]
		if ok && reusable(snapshot, input, input.Order[:i+1]) {
			return i, snapshot
		}
	}
	return -1, Snapshot{}
}

// Reusable reports whether a snapshot still stands for the given prefix.
func Reusable(snapshot Snapshot, input PlanInput, prefix []string) bool {
	return reusable(snapshot, input, prefix)
}

func reusable(snapshot Snapshot, input PlanInput, prefix []string) bool {
	if snapshot.EnvironmentID != input.EnvironmentID || snapshot.Origin != input.Origin || !snapshot.ExpiresAt.After(input.Now) {
		return false
	}
	if len(prefix) == 0 || snapshot.ProfileID != input.Profiles[prefix[len(prefix)-1]] {
		return false
	}
	covered := map[string]bool{}
	for _, id := range snapshot.Covers {
		current, exists := input.Digests[id]
		if !exists || current == "" || snapshot.Digests[id] != current {
			return false
		}
		covered[id] = true
	}
	for _, id := range prefix {
		if !covered[id] {
			return false
		}
	}
	return true
}
