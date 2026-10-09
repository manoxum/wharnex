package workspacetranscript_test

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"kernl.local/harness/backend/internal/app"
	"kernl.local/harness/backend/internal/audit"
	"kernl.local/harness/backend/internal/config"
	"kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/planner/manual"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/sandbox"
	"kernl.local/harness/backend/internal/session"
	"kernl.local/harness/backend/internal/transport/httpapi"
)

func TestAppendEndpointKeepsTranscriptAndRequiresRemotePairing(t *testing.T) {
	store, bus := session.NewStore(), audit.NewBus()
	service := app.NewService(store, bus, contextbundle.NewBuilder(1<<20, 2<<20), manual.New(), policy.NewEngine(), sandbox.NewLocalRunner())
	item, err := service.StartSession(context.Background(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.SetChatID(item.ID, "chat-http"); err != nil {
		t.Fatal(err)
	}
	if _, err := service.SaveWorkspaceChat(domain.WorkspaceChat{ID: "chat-http", SessionID: item.ID, ProjectPath: item.ProjectPath, Title: "HTTP"}); err != nil {
		t.Fatal(err)
	}
	handler := httpapi.New(service, store, bus, config.Config{StateFile: filepath.Join(t.TempDir(), "state.json")})
	body := []byte(`{"items":[{"id":"restored","payload":{"role":"user","text":"original prompt"}}]}`)
	for _, remote := range []bool{true, false, false} {
		req := httptest.NewRequest(http.MethodPost, "/api/workspace-chats/chat-http/items", bytes.NewReader(body))
		if remote {
			req.Header.Set("X-Wharnex-Remote", "1")
		}
		res := httptest.NewRecorder()
		handler.ServeHTTP(res, req)
		want := http.StatusOK
		if remote {
			want = http.StatusUnauthorized
		}
		if res.Code != want {
			t.Fatalf("append status=%d, want=%d: %s", res.Code, want, res.Body.String())
		}
	}
	items, err := store.ListWorkspaceChatItems("chat-http")
	if err != nil || len(items) != 1 {
		t.Fatalf("retry duplicated append: %#v, %v", items, err)
	}
}
