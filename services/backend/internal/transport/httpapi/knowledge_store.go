package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"

	"kernl.local/harness/backend/internal/app"
	"kernl.local/harness/backend/internal/session"
)

// knowledgeCatalog returns the durable catalog, which now lives entirely in the
// local database rather than in committed project files.
func (a *API) knowledgeCatalog(w http.ResponseWriter, r *http.Request) {
	catalog, err := a.service.ProjectKnowledgeCatalog(r.PathValue("id"))
	if err != nil {
		writeSessionError(w, err, "knowledge_read_failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"catalog": catalog})
}

// knowledgeExport writes a portable bundle. An empty ids list exports the whole
// catalog; a non-empty one exports exactly those records and marks the bundle
// selective so an import can never read its omissions as deletions.
func (a *API) knowledgeExport(w http.ResponseWriter, r *http.Request) {
	var body struct {
		IDs []string `json:"ids,omitempty"`
	}
	if r.ContentLength > 0 && !decodeJSON(w, r, &body) {
		return
	}
	export, err := a.service.ExportProjectKnowledge(r.PathValue("id"), body.IDs)
	if err != nil {
		writeSessionError(w, err, "knowledge_export_failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"export": export})
}

// knowledgeImport installs records from a bundle.
func (a *API) knowledgeImport(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Export json.RawMessage `json:"export"`
		Mode   string          `json:"mode,omitempty"`
		IDs    []string        `json:"ids,omitempty"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	export, err := app.ParseKnowledgeExport(body.Export)
	if err != nil {
		writeError(w, http.StatusBadRequest, "knowledge_export_invalid", err.Error())
		return
	}
	report, err := a.service.ImportProjectKnowledge(r.PathValue("id"), export, body.Mode, body.IDs)
	if err != nil {
		writeSessionError(w, err, "knowledge_import_failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"report": report})
}

// knowledgeClear destroys accumulated learning, so it refuses to act without an
// explicit confirmation in the request body. Wharnex never takes this decision
// as part of another operation.
func (a *API) knowledgeClear(w http.ResponseWriter, r *http.Request) {
	var body struct {
		IDs       []string `json:"ids,omitempty"`
		Confirmed bool     `json:"confirmed"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	report, err := a.service.ClearProjectKnowledge(r.PathValue("id"), body.IDs, body.Confirmed)
	if err != nil {
		writeSessionError(w, err, "knowledge_clear_failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"report": report})
}

// knowledgeAdoptLegacyFiles imports a project's pre-migration
// `.wharnex/knowledge/` files into the database. Idempotent, and local records
// always win, so it can be re-run safely.
func (a *API) knowledgeAdoptLegacyFiles(w http.ResponseWriter, r *http.Request) {
	report, err := a.service.AdoptLegacyProjectKnowledgeFiles(r.PathValue("id"))
	if err != nil {
		writeSessionError(w, err, "knowledge_adopt_failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"report": report})
}

// knowledgeConsolidate starts the maintenance round that hands the whole
// catalog to the planner to deduplicate, merge and split.
func (a *API) knowledgeConsolidate(w http.ResponseWriter, r *http.Request) {
	item, err := a.service.StartKnowledgeConsolidation(r.Context(), r.PathValue("id"))
	if err != nil {
		writeSessionError(w, err, "knowledge_consolidation_failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"session": item})
}

func writeSessionError(w http.ResponseWriter, err error, code string) {
	if errors.Is(err, session.ErrNotFound) {
		writeError(w, http.StatusNotFound, "session_not_found", "session not found")
		return
	}
	writeError(w, http.StatusBadRequest, code, err.Error())
}
