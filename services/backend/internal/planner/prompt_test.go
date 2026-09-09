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

func TestBuildManualPromptAlwaysDeclaresKnowledgeV2(t *testing.T) {
	prompt := BuildManualPrompt(Request{RequestID: "req-no-knowledge", Message: "update UI"})
	for _, want := range []string{"PROJECT KNOWLEDGE PROTOCOL", "harness.knowledge/v2", "sharing=off", "summary.md", "knowledge/index.json", "Do NOT request or expect a separate final knowledge_review turn"} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("knowledge protocol prompt missing %q", want)
		}
	}
}

func TestBuildManualPromptReferencesSeparateKnowledgeFilesWithoutInliningContent(t *testing.T) {
	prompt := BuildManualPrompt(Request{
		RequestID: "req-with-knowledge", Message: "update UI", KnowledgeSharingEnabled: true, KnowledgeRevision: 7,
		KnowledgeEntries: []domain.ProjectKnowledgeEntry{{ID: "host-node-version", Content: "Node do host tem de ser >=22.12.", Version: 2}},
	})
	for _, want := range []string{"PROJECT KNOWLEDGE PROTOCOL", "sharing=on", "revision=7 entries=1", "knowledge/<id>.md", "inspect/search", "not decorative context", "mode=replace"} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("prompt missing %q", want)
		}
	}
	if strings.Contains(prompt, "Node do host tem de ser >=22.12") {
		t.Fatal("knowledge entry content must travel as a separate file, not inline in the prompt")
	}
}

func TestBuildManualPromptKnowledgeReviewIsAnswerOnlyAndDistinctFromNormalContract(t *testing.T) {
	const requestID = "req_20260907T010000_knowledgereview01"
	prompt := BuildManualPrompt(Request{
		RequestID: requestID, PlanningMode: "knowledge_review",
		Message:                     `[{"type":"execution.started","data":{"plan_id":"plan-1"}}]`,
		KnowledgeSource:             "- Existing learning.",
		KnowledgeVersion:            3,
		KnowledgeSHA256:             strings.Repeat("a", 64),
		KnowledgeUpdatedByRequestID: "req_20260906T220000_knowledgebase01",
		ExpectedBundleFilename:      "whx_bundle_res_chat1_" + requestID + ".zip",
	})
	for _, want := range []string{
		"WHX KNOWLEDGE REVIEW",
		"FINAL ROUND OF THIS TASK",
		"do not propose a plan",
		"do not return plan.json",
		"Resumo",
		"Conhecimento adquirido",
		"Recomendações",
		"Próximos passos",
		"Do NOT repeat the changed-file list",
		"host command list",
		"knowledge.md",
		"full document, never a diff",
		"Existing learning",
		"Knowledge identity: version=3 sha256=" + strings.Repeat("a", 64) + " updated_by_request_id=req_20260906T220000_knowledgebase01",
		requestID,
		"whx_bundle_res_chat1_" + requestID + ".zip",
	} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("knowledge review prompt missing %q", want)
		}
	}
	// This round must never carry the ordinary CHANGE/WORKFLOW contract: no
	// plan.json is ever valid here, unlike a normal manual prompt.
	for _, mustNotContain := range []string{"CHANGE PLAN CONTRACT", "WORKFLOW PLAN CONTRACT", "REQUEST STRATEGY:"} {
		if strings.Contains(prompt, mustNotContain) {
			t.Fatalf("knowledge review prompt must not carry the normal change/workflow contract, found %q", mustNotContain)
		}
	}
}

func TestBuildManualPromptKnowledgeReviewStatesWhenNoKnowledgeExistsYet(t *testing.T) {
	prompt := BuildManualPrompt(Request{RequestID: "req-kr-empty", PlanningMode: "knowledge_review", Message: "[]"})
	if !strings.Contains(prompt, "No knowledge has been recorded for this project yet") {
		t.Fatal("expected an explicit statement that no knowledge exists yet")
	}
}

func TestBuildManualPromptRequiresUsefulCommitMessageForChangePlans(t *testing.T) {
	prompt := BuildManualPrompt(Request{RequestID: "req-commit", Message: "update UI"})
	for _, want := range []string{
		"COMMIT MESSAGE QUALITY — REQUIRED FOR CHANGE PLANS",
		"permanent developer-facing Git history",
		"ACTUAL delivered patch",
		"feat for a new capability or behavior",
		"fix for a bug/corrective patch",
		"Do not default to chore",
		"what was implemented or corrected",
		"Wharness-verified change",
		"fix(auth): preserve session during concurrent token refresh",
		"Wharness commits your verified patch to its own integration branch",
		"becomes the real commit message in the project's Git history",
	} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("manual prompt missing %q", want)
		}
	}
}

func TestBuildManualPromptAdvertisesRenderableResultArtifacts(t *testing.T) {
	prompt := BuildManualPrompt(Request{RequestID: "req-artifacts", Message: "generate a preview"})
	for _, want := range []string{
		"LOCAL RENDERABLE ARTIFACT CAPABILITY",
		"artifacts/<filename>",
		"images, audio, video, PDF",
		"sandboxed HTML/iframe documents",
		"Markdown, text/source-code files",
		"Office documents via safe text extraction",
		"inline/local chat presentation",
		"non-executable presentation data only",
		"metadata/artifact-presentation.json",
		"harness.artifact-presentation/v1",
		"auto, grid, masonry, and strip",
		"Wharnex derives trusted type/size/capabilities",
	} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("renderable artifact prompt missing %q", want)
		}
	}
}

func TestBuildManualPromptOrchestratorUsesDedicatedPlanningProtocol(t *testing.T) {
	prompt := BuildManualPrompt(Request{RequestID: "req-orchestrator", PlanningMode: "orchestrator", Message: "ship the migration"})
	for _, want := range []string{"harness.orchestrator-plan/v1", "dependency DAG", "never emit shell commands", "ship the migration", "acceptance_criteria", "depends_on"} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("orchestrator prompt missing %q", want)
		}
	}
	for _, forbidden := range []string{"CHANGE PLAN CONTRACT", "plan.json", "harness.execution/v1"} {
		if strings.Contains(prompt, forbidden) {
			t.Fatalf("orchestrator prompt must remain separate from execution planning, found %q", forbidden)
		}
	}
}
