package browsermonitor

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"kernl.local/harness/backend/internal/app/browsermonitor"
)

func TestCatalogRoutePreservesEnvelopeAndContext(t *testing.T) {
	for _, failed := range []bool{false, true} {
		mux := http.NewServeMux()
		request := httptest.NewRequest(http.MethodGet, "/api/browser-monitor/chats", nil)
		Register(mux, func(ctx context.Context) ([]browsermonitor.Chat, error) {
			if ctx != request.Context() {
				t.Fatal("catalog lost the request context")
			}
			if failed {
				return nil, errors.New("catalog unavailable")
			}
			return []browsermonitor.Chat{{Key: "workspace:owned-chat", ChatID: "owned-chat"}}, nil
		})
		response := httptest.NewRecorder()
		mux.ServeHTTP(response, request)
		var body map[string]json.RawMessage
		if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		if response.Header().Get("Content-Type") != "application/json" {
			t.Fatal("missing JSON content type")
		}
		if failed {
			if response.Code != 500 || string(body["error"]) != `{"code":"browser_monitor_catalog_failed","message":"catalog unavailable"}` {
				t.Fatalf("changed error envelope: %d %s", response.Code, response.Body.String())
			}
		} else if response.Code != 200 || len(body["chats"]) == 0 || body["error"] != nil {
			t.Fatalf("changed catalog envelope: %d %s", response.Code, response.Body.String())
		}
	}
}
