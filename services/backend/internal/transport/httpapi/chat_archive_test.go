package httpapi

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"kernl.local/harness/backend/internal/app"
	"kernl.local/harness/backend/internal/audit"
	"kernl.local/harness/backend/internal/config"
	contextbundle "kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/domain"
	manualplanner "kernl.local/harness/backend/internal/planner/manual"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/sandbox"
	"kernl.local/harness/backend/internal/session"
)

type chatArchiveTestArtifactStore struct{ objects map[string][]byte }

func (m *chatArchiveTestArtifactStore) Put(_ context.Context, key, _ string, raw []byte) error {
	m.objects[key] = append([]byte(nil), raw...)
	return nil
}
func (m *chatArchiveTestArtifactStore) Get(_ context.Context, key string) ([]byte, string, error) {
	raw, ok := m.objects[key]
	if !ok {
		return nil, "", errors.New("missing object")
	}
	return append([]byte(nil), raw...), "application/zip", nil
}
func (m *chatArchiveTestArtifactStore) Delete(_ context.Context, key string) error {
	delete(m.objects, key)
	return nil
}

func newChatArchiveTestHandler(t *testing.T) (http.Handler, *session.Store) {
	t.Helper()
	store := session.NewStore()
	bus := audit.NewBus()
	service := app.NewService(store, bus, contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), sandbox.NewLocalRunner())
	service.SetArtifactStore(&chatArchiveTestArtifactStore{objects: map[string][]byte{}}, 30)
	return New(service, store, bus, config.Config{}), store
}

func TestArchiveChatEndpointFlipsState(t *testing.T) {
	handler, store := newChatArchiveTestHandler(t)
	if err := store.Put(domain.Session{ID: "ses_1", ProjectPath: t.TempDir(), CreatedAt: time.Now().UTC()}); err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest("POST", "/api/sessions/ses_1/archive", nil))
	if rec.Code != 200 {
		t.Fatalf("archive status = %d, body = %s", rec.Code, rec.Body.String())
	}

	item, err := store.Get("ses_1")
	if err != nil || item.ArchivedAt == nil {
		t.Fatalf("expected the session to be archived: item=%#v err=%v", item, err)
	}

	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest("POST", "/api/sessions/ses_1/restore", nil))
	if rec.Code != 200 {
		t.Fatalf("restore status = %d, body = %s", rec.Code, rec.Body.String())
	}
	item, err = store.Get("ses_1")
	if err != nil || item.ArchivedAt != nil {
		t.Fatalf("expected the session to be restored: item=%#v err=%v", item, err)
	}
}

func TestArchiveChatEndpointNotFound(t *testing.T) {
	handler, _ := newChatArchiveTestHandler(t)

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest("POST", "/api/sessions/missing/archive", nil))
	if rec.Code != 404 {
		t.Fatalf("archive missing-session status = %d, want 404, body = %s", rec.Code, rec.Body.String())
	}

	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest("POST", "/api/sessions/missing/restore", nil))
	if rec.Code != 404 {
		t.Fatalf("restore missing-session status = %d, want 404, body = %s", rec.Code, rec.Body.String())
	}
}
