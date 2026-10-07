package session

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/bundleusage"
	"kernl.local/harness/backend/internal/oplog"
)

const operationalLogSchema = `
CREATE TABLE IF NOT EXISTS harness_operational_log (
    id text PRIMARY KEY,
    occurred_at timestamptz NOT NULL,
    source text NOT NULL,
    component text NOT NULL,
    level text NOT NULL,
    category text NOT NULL,
    event text NOT NULL,
    message text NOT NULL DEFAULT '',
    session_id text NOT NULL DEFAULT '',
    request_id text NOT NULL DEFAULT '',
    root_request_id text NOT NULL DEFAULT '',
    chat_id text NOT NULL DEFAULT '',
    task_id text NOT NULL DEFAULT '',
    plan_id text NOT NULL DEFAULT '',
    project_id text NOT NULL DEFAULT '',
    event_ref text NOT NULL DEFAULT '',
    data jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS harness_operational_log_time_idx ON harness_operational_log (occurred_at DESC);
CREATE INDEX IF NOT EXISTS harness_operational_log_level_idx ON harness_operational_log (level, occurred_at DESC);
CREATE INDEX IF NOT EXISTS harness_operational_log_component_idx ON harness_operational_log (component, occurred_at DESC);
CREATE INDEX IF NOT EXISTS harness_operational_log_request_idx ON harness_operational_log (request_id, occurred_at) WHERE request_id <> '';
CREATE INDEX IF NOT EXISTS harness_operational_log_root_idx ON harness_operational_log (root_request_id, occurred_at) WHERE root_request_id <> '';
CREATE INDEX IF NOT EXISTS harness_operational_log_chat_idx ON harness_operational_log (chat_id, occurred_at) WHERE chat_id <> '';
CREATE INDEX IF NOT EXISTS harness_operational_log_session_idx ON harness_operational_log (session_id, occurred_at) WHERE session_id <> '';
CREATE INDEX IF NOT EXISTS harness_events_time_type_idx ON harness_events (occurred_at, type);
ALTER TABLE harness_operational_log ADD COLUMN IF NOT EXISTS trace_id text NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS harness_operational_log_trace_idx ON harness_operational_log (trace_id, occurred_at) WHERE trace_id <> '';
`

func ensureOperationalLogSchema(ctx context.Context, db *sql.DB) error {
	if _, err := db.ExecContext(ctx, operationalLogSchema); err != nil {
		return fmt.Errorf("initialize operational log schema: %w", err)
	}
	return nil
}

// AppendOperationalLog persists one batch atomically.
func (s *Store) AppendOperationalLog(ctx context.Context, records []oplog.Record) error {
	if s.db == nil || len(records) == 0 {
		return nil
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	stmt, err := tx.PrepareContext(ctx, `INSERT INTO harness_operational_log
        (id, occurred_at, source, component, level, category, event, message, session_id, request_id, root_request_id, chat_id, task_id, plan_id, project_id, event_ref, data, trace_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) ON CONFLICT (id) DO NOTHING`)
	if err != nil {
		return err
	}
	defer stmt.Close()
	for _, r := range records {
		data, err := json.Marshal(r.Data)
		if err != nil {
			data = []byte(`{"unencodable":true}`)
		}
		if _, err := stmt.ExecContext(ctx, r.ID, r.OccurredAt, r.Source, r.Component, r.Level, r.Category, r.Event, r.Message,
			r.SessionID, r.RequestID, r.RootRequestID, r.ChatID, r.TaskID, r.PlanID, r.ProjectID, r.EventRef, data, r.TraceID); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// QueryOperationalLog returns the newest records matching every set filter.
func (s *Store) QueryOperationalLog(ctx context.Context, filter oplog.Filter) ([]oplog.Record, error) {
	if s.db == nil {
		return nil, nil
	}
	where, args := filter.SQL()
	query := `SELECT id, occurred_at, source, component, level, category, event, message, session_id, request_id, root_request_id,
        chat_id, task_id, plan_id, project_id, event_ref, data, trace_id FROM harness_operational_log`
	if where != "" {
		query += " WHERE " + where
	}
	query += fmt.Sprintf(" ORDER BY occurred_at DESC, id DESC LIMIT %d", filter.BoundedLimit())
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var records []oplog.Record
	for rows.Next() {
		var r oplog.Record
		var data []byte
		if err := rows.Scan(&r.ID, &r.OccurredAt, &r.Source, &r.Component, &r.Level, &r.Category, &r.Event, &r.Message, &r.SessionID,
			&r.RequestID, &r.RootRequestID, &r.ChatID, &r.TaskID, &r.PlanID, &r.ProjectID, &r.EventRef, &data, &r.TraceID); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(data, &r.Data)
		records = append(records, r)
	}
	return records, rows.Err()
}

// BundleTransportUsage projects persisted transport evidence without log-page limits.
func (s *Store) BundleTransportUsage(ctx context.Context, start, end time.Time) ([]bundleusage.Counts, bool, error) {
	if s.db == nil {
		return nil, false, nil
	}
	counts, err := bundleusage.Query(ctx, s.db, start, end)
	return counts, true, err
}

// PruneOperationalLog applies the retention policy and removes the swept
// ledger-noise event types from harness_events.
func (s *Store) PruneOperationalLog(ctx context.Context, now time.Time) (int64, int64, error) {
	if s.db == nil {
		return 0, 0, nil
	}
	verboseBefore, before := oplog.RetentionCutoffs(now)
	logs, err := s.db.ExecContext(ctx, `DELETE FROM harness_operational_log
        WHERE occurred_at < $2 OR (level IN ('trace','debug') AND occurred_at < $1)`, verboseBefore, before)
	if err != nil {
		return 0, 0, err
	}
	events, err := s.db.ExecContext(ctx, `DELETE FROM harness_events WHERE occurred_at < $1 AND type IN (`+placeholders(2, len(oplog.LedgerNoiseEventTypes))+`)`,
		append([]any{before}, stringsAsAny(oplog.LedgerNoiseEventTypes)...)...)
	if err != nil {
		return 0, 0, err
	}
	removedLogs, _ := logs.RowsAffected()
	removedEvents, _ := events.RowsAffected()
	return removedLogs, removedEvents, nil
}

func placeholders(start, count int) string {
	parts := make([]string, count)
	for i := range parts {
		parts[i] = fmt.Sprintf("$%d", start+i)
	}
	return strings.Join(parts, ",")
}

func stringsAsAny(values []string) []any {
	out := make([]any, len(values))
	for i, value := range values {
		out[i] = value
	}
	return out
}
