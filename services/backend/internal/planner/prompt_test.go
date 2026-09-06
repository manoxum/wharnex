package planner

import (
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/domain"
)

func TestBuildManualPromptUsesExecutionBundleDelivery(t *testing.T) {
	const requestID = "req_20260902T222529_d18d51d84abc677c"
	prompt := BuildManualPrompt(Request{RequestID: requestID, Message: "update UI"})

	for _, want := range []string{
		"whx_bundle_res_system_" + requestID + ".zip",
		"FILE-FIRST CONTRACT — ABSOLUTE",
		"FIRST-PASS BUNDLE GATE",
		"plan.json",
		"README.md",
		"patches/",
		"patch_file",
		"PATCH FILE BYTE RULE",
		"exactly two unquoted, space-free paths",
		"ANTI PING-PONG RULE",
		"BUNDLE_GENERATION_UNAVAILABLE",
		"final visible answer contains the downloadable ZIP attachment only",
		"Do NOT call the attachment",
		"generated file basename and downloadable filename metadata MUST both be exactly",
		"icon-only Markdown link",
		"MANDATORY SELF-CHECK BEFORE ATTACHING",
		"Do NOT wrap the required files inside another top-level directory",
		requestID,
		"harness.turn/v1",
		"outcome MUST truthfully report",
		"status=failed/partial",
		"answer",
		"clarification",
		"investigation",
		"For kind=change OR kind=workflow, plan.json MUST exist",
		"ASK FIRST, CODE ONLY WHEN ASKED",
		"kind=workflow",
		"Workflow commands run only in a disposable Protected sandbox",
	} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("manual prompt missing %q", want)
		}
	}
}

func TestBuildManualPromptDoesNotDuplicateStructuredExclusionInventory(t *testing.T) {
	prompt := BuildManualPrompt(Request{
		RequestID: "req-context",
		Message:   "inspect",
		ContextManifest: domain.ContextManifest{
			Excluded:        []string{"node_modules (mandatory security/context exclusion)"},
			ExcludedDetails: []domain.ContextExclusion{{Path: "node_modules", Kind: "directory", Reason: "mandatory security/context exclusion", Rule: "mandatory"}},
		},
	})
	if strings.Contains(prompt, "excluded_details") {
		t.Fatal("structured local inspection details must not bloat planner prompt")
	}
	if !strings.Contains(prompt, "node_modules (mandatory security/context exclusion)") {
		t.Fatal("compact legacy exclusion summary should remain visible to planner")
	}
}

func TestBuildManualPromptMakesAskDistinctFromChange(t *testing.T) {
	prompt := BuildManualPrompt(Request{
		RequestID:      "req-ask",
		Message:        "Que funcionalidade achas que devemos incorporar?",
		AutomationMode: domain.AutomationModeAuto,
	})
	for _, want := range []string{
		"You are NOT primarily a coding agent",
		"questions, explanations, architecture discussion, comparisons, recommendations",
		"do not invent a coding task",
		"Only explicit mutation intent may end in kind=change",
		"turn.message is the actual response the user will read inside Wharness",
		"provide the recommendation, analysis, or diagnosis itself",
	} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("ask-oriented prompt missing %q", want)
		}
	}
}

func TestBuildManualPromptDeclaresSelfEvolutionModeAndLifecycleOwnership(t *testing.T) {
	prompt := BuildManualPrompt(Request{
		RequestID:      "req-self-evolution",
		Message:        "melhorar o próprio Wharness",
		AutomationMode: domain.AutomationModeAuto,
		SelfEvolution:  true,
	})
	for _, want := range []string{
		"SELF-EVOLUTION MODE: true",
		"linked project is exactly the root of the currently running Wharness instance",
		"Never request Unprotected execution",
		"do NOT put Wharness lifecycle commands",
		"detached transactional supervisor",
		"do not mutate .harness runtime/state/log/self-evolution files",
	} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("self-evolution prompt missing %q", want)
		}
	}
}

func TestBuildManualPromptPlanFirstIsPlanningOnly(t *testing.T) {
	prompt := BuildManualPrompt(Request{RequestID: "req-plan-first", Message: "refactor", PlanningMode: "plan_first"})
	for _, want := range []string{"REQUEST STRATEGY: PLAN_FIRST", "NO plan.json", "NO patches/", "## TODO", "separate approved request"} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("plan-first prompt missing %q", want)
		}
	}
}

func TestBuildManualPromptDocumentsGitAndTodoContract(t *testing.T) {
	prompt := BuildManualPrompt(Request{RequestID: "req-git", Message: "commit e push"})
	for _, want := range []string{"Git requests are valid CHANGE requests", "Remote fetch/pull/push MUST set network=true", "force push", "## TODO"} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("git/TODO prompt missing %q", want)
		}
	}
}

func TestBuildManualPromptCarriesTodoAcrossChangeWorkflow(t *testing.T) {
	prompt := BuildManualPrompt(Request{RequestID: "req-workflow-todo", Message: "implementar e verificar"})
	for _, want := range []string{"every workflow turn.message MUST carry", "current ## TODO checklist snapshot", "mark units [x] only when evidence shows"} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("workflow/TODO prompt missing %q", want)
		}
	}
}

func TestBuildManualPromptPinsContextBaselineAndImpactForecast(t *testing.T) {
	const baseline = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	prompt := BuildManualPrompt(Request{RequestID: "req-baseline", Message: "change", ContextManifest: domain.ContextManifest{SHA256: baseline}})
	for _, want := range []string{baseline, "BASELINE CONTEXT SHA256", "base_context_sha256", "impact_files", "concurrent baseline"} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("baseline concurrency prompt missing %q", want)
		}
	}
	if !strings.Contains(prompt, `request_id in turn.json and plan.json MUST be exactly "req-baseline"`) {
		t.Fatal("change contract does not pin the request id")
	}
	if !strings.Contains(prompt, `base_context_sha256 in plan.json MUST be exactly "`+baseline+`"`) {
		t.Fatal("change contract does not pin the context baseline")
	}
}
