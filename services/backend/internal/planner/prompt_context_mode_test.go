package planner

import (
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/domain"
)

func TestPartialPromptsDeclareTheNormativeSeed(t *testing.T) {
	seed := []string{"context/AGENTS.md", "context/SoT/RULES.md"}
	agent := contextModePrompt(Request{ContextMode: domain.ContextModePartial, ContextPaths: seed})
	if !strings.Contains(agent, "normative documents") || !strings.Contains(agent, "- context/SoT/RULES.md\n") {
		t.Fatalf("Agent Partial prompt must declare the preselected normative documents: %s", agent)
	}
	orchestrator := orchestratorContextModePrompt(Request{ContextMode: domain.ContextModePartial, ContextPaths: seed})
	if !strings.Contains(orchestrator, "never request them again: context/AGENTS.md, context/SoT/RULES.md. The request carries") {
		t.Fatalf("Orchestrator Partial prompt must list the seed: %s", orchestrator)
	}
	if unseeded := orchestratorContextModePrompt(Request{ContextMode: domain.ContextModePartial}); !strings.HasPrefix(unseeded, "CONTEXT DELIVERY: Partial. The request carries") {
		t.Fatalf("an unseeded request must keep the original wording: %s", unseeded)
	}
}
