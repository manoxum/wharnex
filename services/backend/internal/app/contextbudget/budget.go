// Package contextbudget owns the budget a Partial-context planner selects
// captured file bodies against.
//
// Only bytes are bounded. How many increment rounds a request takes is the
// planner's decision, so the budget reports rounds used and never a ceiling.
package contextbudget

// MaxSelectedBytes bounds the cumulative bytes of file bodies selected for one
// request across all of its increments.
const MaxSelectedBytes = 64 << 20

// RoundLimitNone is the published round limit: there is none.
const RoundLimitNone = "none"

// Budget is the harness.context-semantic-index/v1 budget block.
type Budget struct {
	MaxSelectedBytes int64  `json:"max_selected_bytes"`
	SelectedBytes    int64  `json:"selected_bytes"`
	RemainingBytes   int64  `json:"remaining_bytes"`
	RoundsUsed       int    `json:"rounds_used"`
	RoundLimit       string `json:"round_limit"`
}

// New reports the budget left after selectedBytes and roundsUsed increments.
func New(selectedBytes int64, roundsUsed int) Budget {
	if roundsUsed < 0 {
		roundsUsed = 0
	}
	return Budget{
		MaxSelectedBytes: MaxSelectedBytes,
		SelectedBytes:    selectedBytes,
		RemainingBytes:   MaxSelectedBytes - selectedBytes,
		RoundsUsed:       roundsUsed,
		RoundLimit:       RoundLimitNone,
	}
}
