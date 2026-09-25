package oplog

import (
	"fmt"
	"strings"
	"time"
)

// Retention: verbose records expire after VerboseRetention, every other
// record after Retention. Nothing is kept longer than Retention.
const (
	VerboseRetention = 3 * 24 * time.Hour
	Retention        = 15 * 24 * time.Hour
)

// RetentionCutoffs returns the instants before which verbose and ordinary
// records are deleted.
func RetentionCutoffs(now time.Time) (verboseBefore, before time.Time) {
	return now.Add(-VerboseRetention), now.Add(-Retention)
}

// Filter selects operational records. Every non-empty field must match.
type Filter struct {
	Since, Until                                time.Time
	MinLevel                                    string
	Source, Component, Category                 string
	SessionID, RequestID, RootRequestID, ChatID string
	TaskID, PlanID, TraceID, Search             string
	Limit                                       int
	// Export raises the page bound to MaxExportRecords for a dossier.
	Export bool
}

const maxQueryLimit = 1000

// BoundedLimit clamps the requested page size.
func (f Filter) BoundedLimit() int {
	if f.Limit <= 0 {
		return 200
	}
	ceiling := f.limitCeiling()
	if f.Limit > ceiling {
		return ceiling
	}
	return f.Limit
}

func (f Filter) limitCeiling() int {
	if f.Export {
		return MaxExportRecords
	}
	return maxQueryLimit
}

// SQL renders the filter as a parameterized WHERE clause.
func (f Filter) SQL() (string, []any) {
	var clauses []string
	var args []any
	add := func(clause string, value any) {
		args = append(args, value)
		clauses = append(clauses, fmt.Sprintf(clause, len(args)))
	}
	if !f.Since.IsZero() {
		add("occurred_at >= $%d", f.Since.UTC())
	}
	if !f.Until.IsZero() {
		add("occurred_at < $%d", f.Until.UTC())
	}
	if levels := levelsAtLeast(f.MinLevel); len(levels) > 0 {
		add("level = ANY($%d)", levels)
	}
	for column, value := range map[string]string{
		"source": f.Source, "component": f.Component, "category": f.Category, "session_id": f.SessionID,
		"request_id": f.RequestID, "root_request_id": f.RootRequestID, "chat_id": f.ChatID, "task_id": f.TaskID, "plan_id": f.PlanID, "trace_id": f.TraceID,
	} {
		if value = strings.TrimSpace(value); value != "" {
			add(column+" = $%d", value)
		}
	}
	if search := strings.TrimSpace(f.Search); search != "" {
		add("(event ILIKE $%[1]d OR message ILIKE $%[1]d)", "%"+escapeLike(search)+"%")
	}
	return strings.Join(clauses, " AND "), args
}

func levelsAtLeast(min string) []string {
	rank, ok := levelRank[strings.ToLower(strings.TrimSpace(min))]
	if !ok {
		return nil
	}
	var levels []string
	for level, value := range levelRank {
		if value >= rank {
			levels = append(levels, level)
		}
	}
	return levels
}

func escapeLike(value string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(value)
}
