package contextbudget

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestBudgetReportsRoundsWithoutACeiling(t *testing.T) {
	budget := New(1024, 11)
	if budget.RoundsUsed != 11 || budget.RoundLimit != RoundLimitNone {
		t.Fatalf("rounds must be reported unclamped and unbounded: %#v", budget)
	}
	if budget.RemainingBytes != MaxSelectedBytes-1024 {
		t.Fatalf("remaining bytes = %d", budget.RemainingBytes)
	}
	raw, err := json.Marshal(budget)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "rounds_remaining") || !strings.Contains(string(raw), `"round_limit":"none"`) {
		t.Fatalf("published budget must not advertise a round ceiling: %s", raw)
	}
}

func TestBudgetClampsNegativeRounds(t *testing.T) {
	if got := New(0, -2).RoundsUsed; got != 0 {
		t.Fatalf("rounds used = %d", got)
	}
}
