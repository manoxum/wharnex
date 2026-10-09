package residency

import (
	"testing"

	"kernl.local/harness/backend/internal/domain"
)

func TestSlimReleasesBodiesWithoutChangingTheWholeAggregate(t *testing.T) {
	item := domain.Session{ID: "ses", State: "verified"}
	item.Context.Manifest.Files = []domain.ContextFile{{Path: "main.go"}}
	item.RequestKnowledge = map[string]domain.RequestKnowledgeSnapshot{"req": {}}
	item.BaselineFileSnapshots = map[string]map[string]string{"base": {"main.go": "sha"}}
	item.RequestSupportArtifacts = map[string][]domain.RequestSupportArtifact{"req": {{Content: []byte("capsule")}}}
	slim := Slim(item)
	if slim.Context.Manifest.Files != nil || slim.RequestKnowledge != nil || slim.BaselineFileSnapshots != nil || slim.RequestSupportArtifacts != nil {
		t.Fatal("slim projection retains heavy request state")
	}
	if len(item.Context.Manifest.Files) != 1 || len(item.RequestKnowledge) != 1 || len(item.BaselineFileSnapshots) != 1 || string(item.RequestSupportArtifacts["req"][0].Content) != "capsule" {
		t.Fatal("demotion mutated the caller's complete aggregate")
	}
	if slim.ID != item.ID || slim.State != item.State {
		t.Fatal("projection lost scan metadata")
	}
}
