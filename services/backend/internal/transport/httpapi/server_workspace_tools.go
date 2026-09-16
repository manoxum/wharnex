package httpapi

import (
	"encoding/json"
	"net/http"
	"strings"

	"kernl.local/harness/backend/internal/app"
)

func (a *API) managedArtifacts(w http.ResponseWriter, r *http.Request) {
	bundlesOnly := r.URL.Query().Get("bundles") == "1"
	items := a.service.ListManagedArtifactsByKind(r.URL.Query().Get("q"), bundlesOnly, r.URL.Query().Get("kind"))
	writeJSON(w, http.StatusOK, map[string]any{"artifacts": items})
}

func (a *API) chatFiles(w http.ResponseWriter, r *http.Request) {
	items, err := a.service.ListChatFiles(r.Context(), r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusNotFound, "session_not_found", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"files": items})
}

func (a *API) saveChatFileToLibrary(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Path string `json:"path"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_chat_file", err.Error())
		return
	}
	record, err := a.service.SaveChatFileToLibrary(r.Context(), r.PathValue("id"), r.PathValue("artifact_id"), body.Path)
	if err != nil {
		writeError(w, http.StatusBadRequest, "library_save_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, record)
}

func (a *API) deleteManagedArtifact(w http.ResponseWriter, r *http.Request) {
	if err := a.service.DeleteManagedArtifact(r.Context(), r.PathValue("session_id"), r.PathValue("artifact_id")); err != nil {
		writeError(w, http.StatusBadRequest, "artifact_delete_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"deleted": true})
}

type postgresToolRequest struct {
	Connection app.PostgresConnection `json:"connection"`
	SQL        string                 `json:"sql,omitempty"`
	ReadOnly   bool                   `json:"read_only,omitempty"`
}

func (a *API) postgresTest(w http.ResponseWriter, r *http.Request) {
	var input postgresToolRequest
	if err := decodePostgresToolRequest(w, r, &input); err != nil {
		return
	}
	if err := a.service.TestPostgres(r.Context(), input.Connection); err != nil {
		writeError(w, http.StatusBadGateway, "postgres_connection_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"connected": true})
}

func (a *API) postgresCatalog(w http.ResponseWriter, r *http.Request) {
	var input postgresToolRequest
	if err := decodePostgresToolRequest(w, r, &input); err != nil {
		return
	}
	catalog, err := a.service.InspectPostgres(r.Context(), input.Connection)
	if err != nil {
		writeError(w, http.StatusBadGateway, "postgres_catalog_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, catalog)
}

func (a *API) postgresQuery(w http.ResponseWriter, r *http.Request) {
	var input postgresToolRequest
	if err := decodePostgresToolRequest(w, r, &input); err != nil {
		return
	}
	result, err := a.service.QueryPostgres(r.Context(), input.Connection, input.SQL, input.ReadOnly)
	if err != nil {
		writeError(w, http.StatusBadRequest, "postgres_query_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func decodePostgresToolRequest(w http.ResponseWriter, r *http.Request, target *postgresToolRequest) error {
	r.Body = http.MaxBytesReader(w, r.Body, 128<<10)
	decoder := json.NewDecoder(r.Body)
	if err := decoder.Decode(target); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error())
		return err
	}
	target.Connection.Host = strings.TrimSpace(target.Connection.Host)
	target.Connection.Database = strings.TrimSpace(target.Connection.Database)
	target.Connection.User = strings.TrimSpace(target.Connection.User)
	return nil
}
