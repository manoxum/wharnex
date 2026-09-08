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
