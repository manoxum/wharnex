package orchestrator

import "testing"

func TestValidateProposalRejectsCycles(t *testing.T) {
	proposal := Proposal{Protocol: ProtocolV1, Title: "Cycle", Objective: "Detect it", Tasks: []ProposalTask{
		{ID: "a", Title: "A", DependsOn: []string{"b"}},
		{ID: "b", Title: "B", DependsOn: []string{"a"}},
	}}
	if err := ValidateProposal(proposal); err == nil {
		t.Fatal("expected dependency cycle to be rejected")
	}
}

func TestEvaluateReadinessRequiresCompleteDependencies(t *testing.T) {
	plan := Plan{ID: "p1", Status: PlanActive}
	dependency := Task{ID: "a", Status: TaskReady}
	task := Task{ID: "b", PlanID: plan.ID, Status: TaskPending, DependsOn: []string{"a"}}
	status, condition := EvaluateReadiness(task, []Task{dependency, task}, plan.Status)
	if status != TaskWaiting || condition != ConditionDependency {
		t.Fatalf("got %s/%s", status, condition)
	}
	dependency.Status = TaskComplete
	status, condition = EvaluateReadiness(task, []Task{dependency, task}, plan.Status)
	if status != TaskPending || condition != ConditionNone {
		t.Fatalf("got %s/%s after dependency completion", status, condition)
	}
	task.Status = TaskReady
	status, condition = EvaluateReadiness(task, []Task{dependency, task}, plan.Status)
	if status != TaskReady || condition != ConditionNone {
		t.Fatalf("released task lost READY after recalculation: %s/%s", status, condition)
	}
}

func TestDraftPlanKeepsTaskPending(t *testing.T) {
	task := Task{ID: "t1", PlanID: "p1", Status: TaskPending}
	status, condition := EvaluateReadiness(task, []Task{task}, PlanDraft)
	if status != TaskPending || condition != ConditionPlanApproval {
		t.Fatalf("got %s/%s", status, condition)
	}
}

func TestValidTaskStatusRejectsUnknownValue(t *testing.T) {
	if ValidTaskStatus(TaskStatus("UNKNOWN")) {
		t.Fatal("unknown task status must be rejected")
	}
	if !ValidTaskStatus(TaskReview) {
		t.Fatal("REVIEW must be a valid task status")
	}
	if !ValidTaskStatus(TaskWaiting) {
		t.Fatal("WAITING must be a valid task status")
	}
}
