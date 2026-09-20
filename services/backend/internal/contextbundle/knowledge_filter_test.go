package contextbundle

import (
	"testing"

	"kernl.local/harness/backend/internal/projectconfig"
)

func TestContextExclusionKeepsManagedProjectKnowledgeOutOfOrdinaryContext(t *testing.T) {
	for _, path := range []string{".wharnex/knowledge", ".wharnex/knowledge/apply-order.md", ".wharnex/knowledge/catalog.json"} {
		reason, rule, ignored := contextExclusion(path, path == ".wharnex/knowledge", nil, projectconfig.ContextConfig{})
		if !ignored || rule != "project-knowledge" || reason == "" {
			t.Fatalf("managed knowledge %q must be transported separately: ignored=%v rule=%q reason=%q", path, ignored, rule, reason)
		}
	}
	if _, _, ignored := contextExclusion(".wharnex/settings.md", false, nil, projectconfig.ContextConfig{}); ignored {
		t.Fatal("only the managed knowledge subtree should be excluded")
	}
}

func TestContextExclusionPrunesAIAssistantStateByDefault(t *testing.T) {
	cfg := projectconfig.ContextConfig{AutoExclude: true}
	for _, rel := range []string{".claude", ".codex", ".gemini", ".opencode"} {
		reason, rule, ignored := contextExclusion(rel, true, nil, cfg)
		if !ignored || rule != "auto-exclude" || reason != "ai assistant state" {
			t.Fatalf("assistant state %q must be pruned by default: ignored=%v rule=%q reason=%q", rel, ignored, rule, reason)
		}
	}
}

func TestContextExclusionAllowsExplicitAssistantStateRestore(t *testing.T) {
	cfg := projectconfig.ContextConfig{AutoExclude: true, IncludeOverride: []string{".claude/settings.json"}}
	for _, tc := range []struct {
		rel   string
		isDir bool
	}{
		{rel: ".claude", isDir: true},
		{rel: ".claude/settings.json"},
	} {
		if reason, rule, ignored := contextExclusion(tc.rel, tc.isDir, nil, cfg); ignored {
			t.Fatalf("explicit restore %q must remain selectable: rule=%q reason=%q", tc.rel, rule, reason)
		}
	}
}
