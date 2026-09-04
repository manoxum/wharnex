package domain

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestExecutionResultMarshalsNilCommandsAsEmptyArray(t *testing.T) {
	payload, err := json.Marshal(ExecutionResult{PlanID: "plan-test"})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(payload), `"commands":[]`) {
		t.Fatalf("execution commands must be a JSON array: %s", payload)
	}
}
