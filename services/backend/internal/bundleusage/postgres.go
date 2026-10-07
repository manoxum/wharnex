package bundleusage

import (
	"context"
	"database/sql"
	"encoding/json"
	"time"

	"kernl.local/harness/backend/internal/oplog"
)

// Query reads the entire transport window; generic operational-log pagination
// must never truncate a consumption statistic. Only metadata is selected.
func Query(ctx context.Context, db *sql.DB, start, end time.Time) ([]Counts, error) {
	rows, err := db.QueryContext(ctx, `SELECT id,occurred_at,source,component,message,task_id,request_id,trace_id,data
		FROM harness_operational_log WHERE occurred_at >= $1 AND occurred_at <= $2 AND (
		(source='desktop' AND component IN ('chatgpt-upload','chatgpt-bundle-received','chatgpt-bundle-download'))
		OR (source='backend' AND component='http' AND data->>'route'=ANY($3)))`, start.Add(-deliveryCorrelationWindow), end, deliveryRoutes)
	if err != nil {
		return nil, err
	}
	var records []oplog.Record
	taskIDs, requestIDs := map[string]bool{}, map[string]bool{}
	for rows.Next() {
		var record oplog.Record
		var data []byte
		if err := rows.Scan(&record.ID, &record.OccurredAt, &record.Source, &record.Component, &record.Message, &record.TaskID, &record.RequestID, &record.TraceID, &data); err != nil {
			rows.Close()
			return nil, err
		}
		if err := json.Unmarshal(data, &record.Data); err != nil {
			rows.Close()
			return nil, err
		}
		if item, ok := classify(record); ok {
			records = append(records, record)
			if item.taskID != "" {
				taskIDs[item.taskID] = true
			}
			if item.requestID != "" {
				requestIDs[item.requestID] = true
			}
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	tasks, err := readTasks(ctx, db, keys(taskIDs), keys(requestIDs))
	if err != nil {
		return nil, err
	}
	return Summarize(records, tasks, start, end), nil
}

func readTasks(ctx context.Context, db *sql.DB, taskIDs, requestIDs []string) ([]Task, error) {
	// task_id is the shipped task-ledger identifier. No relational joins are
	// introduced; this compatibility boundary resolves ids to type metadata.
	rows, err := db.QueryContext(ctx, `SELECT task_id,type,request_id,source FROM harness_tasks
		WHERE task_id=ANY($1) OR request_id=ANY($2) ORDER BY created_at,task_id`, taskIDs, requestIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var tasks []Task
	for rows.Next() {
		var task Task
		if err := rows.Scan(&task.ID, &task.Type, &task.RequestID, &task.Source); err != nil {
			return nil, err
		}
		tasks = append(tasks, task)
	}
	return tasks, rows.Err()
}

func keys(values map[string]bool) []string {
	result := make([]string, 0, len(values))
	for key := range values {
		result = append(result, key)
	}
	return result
}
