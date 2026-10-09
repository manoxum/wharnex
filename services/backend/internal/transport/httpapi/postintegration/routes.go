package postintegration

import (
	"context"
	"encoding/json"
	"net/http"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/planner"
)

type Observer interface {
	SubmitPostIntegrationObservation(context.Context, string, string) (planner.Result, domain.Session, error)
}

func Register(mux *http.ServeMux, service Observer) {
	mux.HandleFunc("POST /api/sessions/{id}/post-integration-observation", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		var body struct {
			Guidance string `json:"guidance"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16000)).Decode(&body); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]string{"code": "invalid_post_integration_observation", "message": "bounded JSON guidance is required"}})
			return
		}
		result, item, err := service.SubmitPostIntegrationObservation(r.Context(), r.PathValue("id"), body.Guidance)
		if err != nil {
			w.WriteHeader(http.StatusConflict)
			_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]string{"code": "post_integration_observation_unavailable", "message": err.Error()}})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"session": item, "turn": result.Turn, "plan": result.Plan, "manual_prompt": result.ManualPrompt})
	})
}
