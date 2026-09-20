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

func TestAutoApproveIsAProtectedAutomaticMode(t *testing.T) {
	if !ValidAutomationMode(AutomationModeAutoApprove) {
		t.Fatal("auto_approve must be a valid automation mode")
	}
	if !AutomationModeIsAutomatic(AutomationModeAutoApprove) {
		t.Fatal("auto_approve must inherit automatic continuation semantics")
	}
	if !AutomationModeApproves(AutomationModeAutoApprove) || AutomationModeApproves(AutomationModeAuto) {
		t.Fatal("only auto_approve may pre-authorize eligible execution approvals")
	}
}
