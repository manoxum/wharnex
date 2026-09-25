package oplog

import (
	"time"
)

// DossierProtocol identifies an exported slice of the operational log. The
// file is plain untrusted evidence: the self-evolution dossier import accepts
// it as `.json`, sanitizes its text and never treats it as instructions.
const DossierProtocol = "wharnex.operational-log-dossier/v1"

// MaxExportRecords bounds one exported dossier.
const MaxExportRecords = 5000

// Dossier is a filtered, summarized slice of the operational log.
type Dossier struct {
	Protocol    string         `json:"protocol"`
	GeneratedAt time.Time      `json:"generated_at"`
	Filter      map[string]any `json:"filter"`
	Summary     DossierSummary `json:"summary"`
	Records     []Record       `json:"records"`
}

// DossierSummary lets a reader, human or model, see the shape of the slice
// before reading any record.
type DossierSummary struct {
	Count       int            `json:"count"`
	Truncated   bool           `json:"truncated"`
	First       *time.Time     `json:"first,omitempty"`
	Last        *time.Time     `json:"last,omitempty"`
	ByLevel     map[string]int `json:"by_level"`
	BySource    map[string]int `json:"by_source"`
	ByComponent map[string]int `json:"by_component"`
	Requests    []string       `json:"requests"`
}

// NewDossier summarizes records, which arrive newest first, and returns them
// oldest first so the file reads as a timeline.
func NewDossier(filter Filter, records []Record, limit int, now time.Time) Dossier {
	ordered := make([]Record, len(records))
	for i, record := range records {
		ordered[len(records)-1-i] = record
	}
	summary := DossierSummary{
		Count: len(ordered), Truncated: len(ordered) >= limit,
		ByLevel: map[string]int{}, BySource: map[string]int{}, ByComponent: map[string]int{}, Requests: []string{},
	}
	seen := map[string]bool{}
	for i := range ordered {
		record := ordered[i]
		summary.ByLevel[record.Level]++
		summary.BySource[record.Source]++
		summary.ByComponent[record.Component]++
		if record.RequestID != "" && !seen[record.RequestID] && len(summary.Requests) < 200 {
			seen[record.RequestID] = true
			summary.Requests = append(summary.Requests, record.RequestID)
		}
	}
	if len(ordered) > 0 {
		first, last := ordered[0].OccurredAt, ordered[len(ordered)-1].OccurredAt
		summary.First, summary.Last = &first, &last
	}
	return Dossier{Protocol: DossierProtocol, GeneratedAt: now.UTC(), Filter: filter.Describe(), Summary: summary, Records: ordered}
}

// Describe reports the non-empty filter fields for the dossier header.
func (f Filter) Describe() map[string]any {
	described := map[string]any{}
	for key, value := range map[string]string{
		"min_level": f.MinLevel, "source": f.Source, "component": f.Component, "category": f.Category, "session_id": f.SessionID,
		"request_id": f.RequestID, "root_request_id": f.RootRequestID, "chat_id": f.ChatID, "task_id": f.TaskID,
		"plan_id": f.PlanID, "trace_id": f.TraceID, "q": f.Search,
	} {
		if value != "" {
			described[key] = value
		}
	}
	if !f.Since.IsZero() {
		described["since"] = f.Since.UTC().Format(time.RFC3339)
	}
	if !f.Until.IsZero() {
		described["until"] = f.Until.UTC().Format(time.RFC3339)
	}
	return described
}
