package session

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/domain"
)

type executionErrorScanner interface {
	Scan(dest ...any) error
}

func (s *Store) RecordExecutionError(record domain.ExecutionErrorRecord) error {
	if strings.TrimSpace(record.ID) == "" || strings.TrimSpace(record.SessionID) == "" {
		return fmt.Errorf("execution error requires id and session_id")
	}
	if record.Logs == nil {
		record.Logs = []domain.ExecutionErrorLog{}
	}
	if record.Status == "" {
		record.Status = domain.ExecutionErrorStatusOpen
	}
	if record.OccurredAt.IsZero() {
		record.OccurredAt = time.Now().UTC()
	}
	if record.UpdatedAt.IsZero() {
		record.UpdatedAt = record.OccurredAt
	}
	if s.db != nil {
		logs, err := json.Marshal(record.Logs)
		if err != nil {
			return fmt.Errorf("encode execution error logs: %w", err)
		}
		var solution any
		if record.GPTSolution != nil {
			solution, err = json.Marshal(record.GPTSolution)
			if err != nil {
				return fmt.Errorf("encode execution error solution: %w", err)
			}
		}
		_, err = s.db.Exec(`INSERT INTO harness_execution_errors
			(id,session_id,chat_id,root_request_id,request_id,plan_id,stage,error,cause,failure_kind,status_code,logs,status,gpt_solution,occurred_at,resolved_at,updated_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
			ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status,gpt_solution=EXCLUDED.gpt_solution,resolved_at=EXCLUDED.resolved_at,updated_at=EXCLUDED.updated_at`,
			record.ID, record.SessionID, record.ChatID, record.RootRequestID, record.RequestID, record.PlanID, record.Stage,
			record.Error, record.Cause, record.FailureKind, record.StatusCode, logs, record.Status, solution,
			record.OccurredAt, record.ResolvedAt, record.UpdatedAt)
		return wrapPostgresError("record execution error", err)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.executionErrors == nil {
		s.executionErrors = make(map[string]domain.ExecutionErrorRecord)
	}
	s.executionErrors[record.ID] = record
	return nil
}

func (s *Store) ResolveExecutionErrors(sessionID, rootRequestID string, solution domain.ExecutionErrorSolution) (int64, error) {
	now := time.Now().UTC()
	if s.db != nil {
		rawSolution, err := json.Marshal(solution)
		if err != nil {
			return 0, fmt.Errorf("encode execution error solution: %w", err)
		}
		result, err := s.db.Exec(`UPDATE harness_execution_errors
			SET status=$3,gpt_solution=$4,resolved_at=$5,updated_at=$5
			WHERE session_id=$1 AND root_request_id=$2 AND status<>$3`,
			sessionID, rootRequestID, domain.ExecutionErrorStatusSolved, rawSolution, now)
		if err != nil {
			return 0, wrapPostgresError("resolve execution errors", err)
		}
		count, err := result.RowsAffected()
		return count, wrapPostgresError("count resolved execution errors", err)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	var count int64
	for id, item := range s.executionErrors {
		if item.SessionID != sessionID || item.RootRequestID != rootRequestID || item.Status == domain.ExecutionErrorStatusSolved {
			continue
		}
		item.Status = domain.ExecutionErrorStatusSolved
		item.GPTSolution = &solution
		item.ResolvedAt = &now
		item.UpdatedAt = now
		s.executionErrors[id] = item
		count++
	}
	return count, nil
}

func (s *Store) ExecutionErrors(sessionID string) ([]domain.ExecutionErrorRecord, error) {
	if s.db != nil {
		rows, err := s.db.Query(`SELECT id,session_id,chat_id,root_request_id,request_id,plan_id,stage,error,cause,failure_kind,status_code,logs,status,gpt_solution,occurred_at,resolved_at,updated_at
			FROM harness_execution_errors WHERE session_id=$1 ORDER BY occurred_at DESC,id DESC`, sessionID)
		if err != nil {
			return nil, wrapPostgresError("list execution errors", err)
		}
		defer rows.Close()
		items := make([]domain.ExecutionErrorRecord, 0)
		for rows.Next() {
			item, scanErr := scanExecutionError(rows)
			if scanErr != nil {
				return nil, scanErr
			}
			items = append(items, item)
		}
		return items, wrapPostgresError("iterate execution errors", rows.Err())
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	items := make([]domain.ExecutionErrorRecord, 0)
	for _, item := range s.executionErrors {
		if item.SessionID == sessionID {
			items = append(items, item)
		}
	}
	sort.Slice(items, func(i, j int) bool { return items[i].OccurredAt.After(items[j].OccurredAt) })
	return items, nil
}

func scanExecutionError(scanner executionErrorScanner) (domain.ExecutionErrorRecord, error) {
	var item domain.ExecutionErrorRecord
	var statusCode sql.NullInt64
	var logs, solution []byte
	var resolvedAt sql.NullTime
	if err := scanner.Scan(&item.ID, &item.SessionID, &item.ChatID, &item.RootRequestID, &item.RequestID, &item.PlanID,
		&item.Stage, &item.Error, &item.Cause, &item.FailureKind, &statusCode, &logs, &item.Status, &solution,
		&item.OccurredAt, &resolvedAt, &item.UpdatedAt); err != nil {
		return item, err
	}
	if statusCode.Valid {
		value := int(statusCode.Int64)
		item.StatusCode = &value
	}
	if err := json.Unmarshal(logs, &item.Logs); err != nil {
		return item, fmt.Errorf("decode execution error logs: %w", err)
	}
	if len(solution) > 0 && string(solution) != "null" {
		var decoded domain.ExecutionErrorSolution
		if err := json.Unmarshal(solution, &decoded); err != nil {
			return item, fmt.Errorf("decode execution error solution: %w", err)
		}
		item.GPTSolution = &decoded
	}
	if resolvedAt.Valid {
		item.ResolvedAt = &resolvedAt.Time
	}
	return item, nil
}
