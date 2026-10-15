package postintegration_test

import (
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/domain"
)

func TestOperatorRuntimeGuidanceAppearsInBoundChat(t *testing.T) {
	service, _, started := integratedFixture(t)
	if _, err := service.SetChatID(started.ID, "chat-runtime"); err != nil {
		t.Fatal(err)
	}
	if _, err := service.SaveWorkspaceChat(domain.WorkspaceChat{ID: "chat-runtime", SessionID: started.ID, ProjectPath: started.ProjectPath, Title: "Runtime"}); err != nil {
		t.Fatal(err)
	}
	_, current, err := service.SubmitPostIntegrationObservation(t.Context(), started.ID, "Check deleted and active cases with the actual app login.")
	if err != nil {
		t.Fatal(err)
	}
	items, err := service.ListWorkspaceChatItems("chat-runtime")
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].ID != "request:"+current.LastRequestID || !strings.Contains(items[0].Payload["text"].(string), "actual app login") {
		t.Fatalf("accepted operator guidance must be durable and visible: %+v", items)
	}
}
