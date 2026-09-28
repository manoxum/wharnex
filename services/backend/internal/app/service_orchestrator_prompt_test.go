package app

import (
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/orchestrator"
)

func TestOrchestratorTaskPromptCarriesCoordinationContextButScopesTheTask(t *testing.T) {
	plan := orchestrator.Plan{ID: "opl_1", Title: "Kanban evolution", Objective: "Make task cards readable and load them progressively."}
	current := orchestrator.Task{ID: "otk_current", PlanID: plan.ID, Title: "Readable cards", Status: orchestrator.TaskDoing, DependsOn: []string{"otk_dep"}}
	tasks := []orchestrator.Task{
		current,
		{ID: "otk_dep", PlanID: plan.ID, Title: "Card data model", Status: orchestrator.TaskReview},
		{ID: "otk_next", PlanID: plan.ID, Title: "Progressive loading", Status: orchestrator.TaskPending, DependsOn: []string{"otk_current"}},
		{ID: "otk_parallel", PlanID: "opl_other", Title: "Queue details", Status: orchestrator.TaskDoing, ImpactFiles: []string{"src/Queue.tsx"}},
		{ID: "otk_done", PlanID: plan.ID, Title: "Unrelated finished", Status: orchestrator.TaskComplete},
	}
	prompt := orchestratorTaskPromptWithContext(current, &plan, tasks)
	for _, want := range []string{
		"Make task cards readable and load them progressively.",
		`"id": "otk_dep"`, "Card data model",
		`"id": "otk_next"`, "Progressive loading",
		`"id": "otk_parallel"`, "src/Queue.tsx",
		"ONLY the task",
	} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("prompt lacks %q:\n%s", want, prompt)
		}
	}
	// The coordination block names other work; the task itself stays the
	// only thing the planner is asked to execute.
	if strings.Contains(prompt, "Unrelated finished") {
		t.Fatalf("a finished task unrelated to this one leaked into the context:\n%s", prompt)
	}
	if strings.Index(prompt, "Readable cards") > strings.Index(prompt, "ORCHESTRATION CONTEXT") {
		t.Fatalf("the task must come before its coordination context:\n%s", prompt)
	}
}

func TestOrchestratorTaskPromptWithoutContextKeepsTheTask(t *testing.T) {
	prompt := orchestratorTaskPromptWithContext(orchestrator.Task{ID: "otk_x", Title: "Alone"}, nil, nil)
	if !strings.Contains(prompt, "Alone") || strings.Contains(prompt, "ORCHESTRATION CONTEXT") {
		t.Fatalf("unexpected prompt:\n%s", prompt)
	}
}
