package domain

import "testing"

func TestNormalizeKnowledgeCategory(t *testing.T) {
	tests := []struct {
		name     string
		category string
		id       string
		content  string
		want     string
	}{
		{name: "explicit canonical", category: " verification ", want: KnowledgeCategoryVerification},
		{name: "unknown explicit fails closed", category: "future_category", id: "patch-repair", content: "git apply failed", want: KnowledgeCategoryGeneral},
		{name: "legacy patch", id: "patch-rebase-strategy", content: "git apply hunk mismatch", want: KnowledgeCategoryPatchStrategy},
		{name: "legacy conflict", id: "manual-conflict-resolution", content: "three-way merge", want: KnowledgeCategoryConflictResolution},
		{name: "legacy ambiguous", id: "project-ui-notes", content: "Business-specific screen behavior", want: KnowledgeCategoryGeneral},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := NormalizeKnowledgeCategory(tt.category, tt.id, tt.content); got != tt.want {
				t.Fatalf("NormalizeKnowledgeCategory() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestKnowledgeCategorySupportsSelfEvolution(t *testing.T) {
	for _, category := range []string{
		KnowledgeCategoryConflictResolution,
		KnowledgeCategoryPatchStrategy,
		KnowledgeCategoryExecutionRepair,
		KnowledgeCategoryVerification,
		KnowledgeCategoryRuntimeEnvironment,
		KnowledgeCategoryProtocolTransport,
	} {
		if !KnowledgeCategorySupportsSelfEvolution(category) {
			t.Fatalf("expected %q to be self-evolution eligible", category)
		}
	}
	for _, category := range []string{KnowledgeCategoryProductDomain, KnowledgeCategoryGeneral, "unknown"} {
		if KnowledgeCategorySupportsSelfEvolution(category) {
			t.Fatalf("expected %q to be excluded from self-evolution", category)
		}
	}
}

func TestIsKnowledgeCategory(t *testing.T) {
	if !IsKnowledgeCategory(" Product_Domain ") {
		t.Fatal("expected canonical category matching to ignore case and outer space")
	}
	if IsKnowledgeCategory("business_rules") {
		t.Fatal("unexpected support for unknown category")
	}
}
