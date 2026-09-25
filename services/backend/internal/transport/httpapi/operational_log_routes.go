package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"kernl.local/harness/backend/internal/oplog"
)

const (
	maxOperationalLogBody  = 1 << 20
	maxOperationalLogBatch = 500
)

func (a *API) registerOperationalLogRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/operational-log", a.ingestOperationalLog)
	mux.HandleFunc("GET /api/operational-log", a.queryOperationalLog)
	mux.HandleFunc("GET /api/operational-log/export", a.exportOperationalLog)
}

// The operational log describes local runtime internals; the paired remote
// ingress may neither write nor read it.
func refuseRemoteOperationalLog(w http.ResponseWriter, r *http.Request) bool {
	if r.Header.Get("X-Wharnex-Remote") != "1" {
		return false
	}
	writeError(w, http.StatusForbidden, "operational_log_local_only", "the operational log is available only to the local Wharnex runtime")
	return true
}

func (a *API) ingestOperationalLog(w http.ResponseWriter, r *http.Request) {
	if refuseRemoteOperationalLog(w, r) {
		return
	}
	var body struct {
		Records []oplog.Record `json:"records"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxOperationalLogBody)).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_operational_log", err.Error())
		return
	}
	if len(body.Records) > maxOperationalLogBatch {
		writeError(w, http.StatusRequestEntityTooLarge, "operational_log_batch_too_large", "at most 500 records per batch")
		return
	}
	now := time.Now().UTC()
	records := body.Records[:0]
	for _, record := range body.Records {
		if record.Source != oplog.SourceDesktop && record.Source != oplog.SourceFrontend {
			continue
		}
		// The server owns identity and cross-ledger references.
		record.ID, record.EventRef = "", ""
		record.Normalize(now)
		records = append(records, record)
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	if err := a.store.AppendOperationalLog(ctx, records); err != nil {
		writeError(w, http.StatusServiceUnavailable, "operational_log_unavailable", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"accepted": len(records)})
}

func (a *API) queryOperationalLog(w http.ResponseWriter, r *http.Request) {
	if refuseRemoteOperationalLog(w, r) {
		return
	}
	filter, ok := parseOperationalLogFilter(w, r)
	if !ok {
		return
	}
	records, err := a.store.QueryOperationalLog(r.Context(), filter)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "operational_log_unavailable", err.Error())
		return
	}
	if records == nil {
		records = []oplog.Record{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"records": records})
}

func (a *API) exportOperationalLog(w http.ResponseWriter, r *http.Request) {
	if refuseRemoteOperationalLog(w, r) {
		return
	}
	filter, ok := parseOperationalLogFilter(w, r)
	if !ok {
		return
	}
	filter.Export = true
	if filter.Limit <= 0 {
		filter.Limit = oplog.MaxExportRecords
	}
	records, err := a.store.QueryOperationalLog(r.Context(), filter)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "operational_log_unavailable", err.Error())
		return
	}
	now := time.Now().UTC()
	w.Header().Set("Content-Disposition", `attachment; filename="wharnex-diario-`+now.Format("20060102T150405Z")+`.json"`)
	writeJSON(w, http.StatusOK, oplog.NewDossier(filter, records, filter.BoundedLimit(), now))
}

func parseOperationalLogFilter(w http.ResponseWriter, r *http.Request) (oplog.Filter, bool) {
	query := r.URL.Query()
	filter := oplog.Filter{
		MinLevel: query.Get("min_level"), Source: query.Get("source"), Component: query.Get("component"), Category: query.Get("category"),
		SessionID: query.Get("session_id"), RequestID: query.Get("request_id"), RootRequestID: query.Get("root_request_id"),
		ChatID: query.Get("chat_id"), TaskID: query.Get("task_id"), PlanID: query.Get("plan_id"), TraceID: query.Get("trace_id"), Search: query.Get("q"),
	}
	filter.Limit, _ = strconv.Atoi(query.Get("limit"))
	for name, target := range map[string]*time.Time{"since": &filter.Since, "until": &filter.Until} {
		if value := query.Get(name); value != "" {
			parsed, err := time.Parse(time.RFC3339, value)
			if err != nil {
				writeError(w, http.StatusBadRequest, "invalid_operational_log_filter", name+" must be RFC3339")
				return filter, false
			}
			*target = parsed
		}
	}
	return filter, true
}
