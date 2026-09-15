package session

import (
	"database/sql"
	"fmt"
	"strings"
	"time"
)

const chatAgentTaskColumns = `task_id,type,project_id,chat_id,session_id,request_id,root_request_id,conversation_id,parent_task_id,
	priority,status,not_before,attempt,max_attempts,dedupe_key,assigned_worker,keep_flowing,lease_owner,lease_expires_at,payload,last_error,created_at,updated_at`

func qualifiedChatAgentTaskColumns(alias string) string {
	columns := strings.Split(chatAgentTaskColumns, ",")
	for index, column := range columns {
		columns[index] = alias + "." + strings.TrimSpace(column)
	}
	return strings.Join(columns, ",")
}

func scanChatAgentTask(scanner interface{ Scan(...any) error }) (ChatAgentTask, error) {
	var task ChatAgentTask
	var lease sql.NullTime
	err := scanner.Scan(
		&task.TaskID, &task.Type, &task.ProjectID, &task.ChatID, &task.SessionID, &task.RequestID,
		&task.RootRequestID, &task.ConversationID, &task.ParentTaskID, &task.Priority, &task.Status,
		&task.NotBefore, &task.Attempt, &task.MaxAttempts, &task.DedupeKey, &task.AssignedWorker,
		&task.KeepFlowing, &task.LeaseOwner, &lease, &task.Payload, &task.LastError, &task.CreatedAt, &task.UpdatedAt,
	)
	if lease.Valid {
		value := lease.Time
		task.LeaseExpiresAt = &value
	}
	return task, err
}

func (s *Store) postgresEnqueueChatAgentTask(task ChatAgentTask) (ChatAgentTask, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return ChatAgentTask{}, fmt.Errorf("begin chat agent enqueue: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if task.DedupeKey != "" {
		row := tx.QueryRow(`SELECT `+chatAgentTaskColumns+` FROM harness_chat_agent_tasks
			WHERE dedupe_key=$1 AND status IN ('PENDING','LEASED','RUNNING','WAITING')
			ORDER BY created_at, task_id LIMIT 1`, task.DedupeKey)
		if existing, scanErr := scanChatAgentTask(row); scanErr == nil {
			return existing, tx.Commit()
		} else if scanErr != sql.ErrNoRows {
			return ChatAgentTask{}, fmt.Errorf("lookup chat agent dedupe key: %w", scanErr)
		}
	}
	result, err := tx.Exec(`INSERT INTO harness_chat_agent_tasks (`+chatAgentTaskColumns+`)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'',false,'',NULL,$16,'',$17,$17)
		ON CONFLICT DO NOTHING`,
		task.TaskID, task.Type, task.ProjectID, task.ChatID, task.SessionID, task.RequestID,
		task.RootRequestID, task.ConversationID, task.ParentTaskID, task.Priority, task.Status,
		task.NotBefore, task.Attempt, task.MaxAttempts, task.DedupeKey, task.Payload, task.CreatedAt)
	if err != nil {
		return ChatAgentTask{}, fmt.Errorf("persist chat agent task: %w", err)
	}
	if count, _ := result.RowsAffected(); count == 0 && task.DedupeKey != "" {
		row := tx.QueryRow(`SELECT `+chatAgentTaskColumns+` FROM harness_chat_agent_tasks
			WHERE dedupe_key=$1 AND status IN ('PENDING','LEASED','RUNNING','WAITING')
			ORDER BY created_at, task_id LIMIT 1`, task.DedupeKey)
		existing, scanErr := scanChatAgentTask(row)
		if scanErr != nil {
			return ChatAgentTask{}, fmt.Errorf("resolve chat agent dedupe conflict: %w", scanErr)
		}
		return existing, tx.Commit()
	}
	if err := tx.Commit(); err != nil {
		return ChatAgentTask{}, fmt.Errorf("commit chat agent enqueue: %w", err)
	}
	return task, nil
}

func (s *Store) postgresGetChatAgentTask(taskID string) (ChatAgentTask, error) {
	task, err := scanChatAgentTask(s.db.QueryRow(`SELECT `+chatAgentTaskColumns+` FROM harness_chat_agent_tasks WHERE task_id=$1`, taskID))
	if err == sql.ErrNoRows {
		return ChatAgentTask{}, ErrChatAgentTaskNotFound
	}
	if err != nil {
		return ChatAgentTask{}, fmt.Errorf("get chat agent task: %w", err)
	}
	return task, nil
}

func (s *Store) postgresListChatAgentTasks(filter ChatAgentTaskFilter) ([]ChatAgentTask, error) {
	where := []string{"TRUE"}
	args := make([]any, 0, 7)
	add := func(column, value string) {
		if strings.TrimSpace(value) == "" {
			return
		}
		args = append(args, value)
		where = append(where, fmt.Sprintf("%s=$%d", column, len(args)))
	}
	add("project_id", filter.ProjectID)
	add("chat_id", filter.ChatID)
	add("session_id", filter.SessionID)
	add("request_id", filter.RequestID)
	add("type", filter.Type)
	add("status", filter.Status)
	if filter.ActiveOnly {
		where = append(where, "status IN ('PENDING','LEASED','RUNNING','WAITING')")
	}
	query := `SELECT ` + chatAgentTaskColumns + ` FROM harness_chat_agent_tasks WHERE ` +
		strings.Join(where, " AND ") + ` ORDER BY created_at, task_id`
	limit := filter.Limit
	if limit > 500 {
		limit = 500
	}
	if limit <= 0 && !filter.ActiveOnly {
		limit = 200
	}
	if limit > 0 {
		args = append(args, limit)
		query += fmt.Sprintf(` LIMIT $%d`, len(args))
	}
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("list chat agent tasks: %w", err)
	}
	defer rows.Close()
	items := make([]ChatAgentTask, 0, limit)
	for rows.Next() {
		task, scanErr := scanChatAgentTask(rows)
		if scanErr != nil {
			return nil, fmt.Errorf("scan chat agent task: %w", scanErr)
		}
		items = append(items, task)
	}
	return items, rows.Err()
}

func (s *Store) postgresClaimChatAgentTask(owner string, lease time.Duration, options ChatAgentClaimOptions) (*ChatAgentTask, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return nil, fmt.Errorf("begin chat agent claim: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	var providerPaused bool
	var providerUntil sql.NullTime
	if err := tx.QueryRow(`SELECT paused, paused_until FROM harness_chat_agent_provider_state
		WHERE provider='chatgpt' FOR UPDATE`).Scan(&providerPaused, &providerUntil); err != nil {
		return nil, fmt.Errorf("lock chat agent provider state: %w", err)
	}
	now := time.Now().UTC()
	if providerPaused && (!providerUntil.Valid || providerUntil.Time.After(now)) {
		if err := tx.Commit(); err != nil {
			return nil, fmt.Errorf("commit paused chat agent claim: %w", err)
		}
		return nil, nil
	}
	if providerPaused && providerUntil.Valid {
		if _, err := tx.Exec(`UPDATE harness_chat_agent_provider_state
			SET paused=false, paused_until=NULL, reason='', updated_at=now() WHERE provider='chatgpt'`); err != nil {
			return nil, fmt.Errorf("resume expired chat agent provider pause: %w", err)
		}
	}
	if _, err := tx.Exec(`UPDATE harness_chat_agent_tasks
		SET status=CASE WHEN attempt>=max_attempts THEN 'FAILED' ELSE 'PENDING' END,
			last_error=CASE WHEN attempt>=max_attempts THEN 'lease expired after maximum attempts' ELSE last_error END,
			lease_owner='', lease_expires_at=NULL, updated_at=now()
		WHERE status IN ('LEASED','RUNNING') AND lease_expires_at IS NOT NULL AND lease_expires_at<=now()`); err != nil {
		return nil, fmt.Errorf("requeue expired chat agent leases: %w", err)
	}
	seconds := int64(lease / time.Second)
	laneExpr := `CASE WHEN t.conversation_id<>'' THEN 'c:'||t.conversation_id ELSE 'h:'||t.chat_id END`
	args := []any{owner, seconds, options.PreferredLane, options.FallbackMode, options.WorkerID}
	excludedSQL := ""
	if len(options.ExcludedLanes) > 0 {
		parts := make([]string, 0, len(options.ExcludedLanes))
		for _, lane := range options.ExcludedLanes {
			args = append(args, lane)
			parts = append(parts, fmt.Sprintf("$%d", len(args)))
		}
		excludedSQL = " AND " + laneExpr + " NOT IN (" + strings.Join(parts, ",") + ")"
	}
	// Project scoping belongs in the claim itself, not after it: a claim charges
	// an attempt, so claiming and releasing would spend a task's own retry
	// budget on a decision about which windows are open.
	projectSQL := ""
	if options.ProjectScoped {
		open := "FALSE"
		if len(options.OpenProjects) > 0 {
			parts := make([]string, 0, len(options.OpenProjects))
			for _, project := range options.OpenProjects {
				args = append(args, project)
				parts = append(parts, fmt.Sprintf("$%d", len(args)))
			}
			open = "t.project_id IN (" + strings.Join(parts, ",") + ")"
		}
		projectSQL = " AND (t.project_id='' OR " + chatAgentTaskAccountSQL("t.type") + " OR " + open + ")"
	}
	// Pool partition. An explicit operator pin overrides it, exactly as in the
	// in-memory fallback: otherwise a task pinned across the partition would be
	// reachable by no pool at all.
	roleSQL := ""
	switch options.Role {
	case ChatAgentRoleSupervisor:
		roleSQL = " AND (t.assigned_worker<>'' OR " + chatAgentTaskSupervisorSQL("t.type") + ")"
	case ChatAgentRoleWorker:
		roleSQL = " AND (t.assigned_worker<>'' OR NOT " + chatAgentTaskSupervisorSQL("t.type") + ")"
	}
	query := `WITH candidate AS (
		SELECT t.task_id FROM harness_chat_agent_tasks t
		WHERE t.status IN ('PENDING','WAITING') AND t.not_before<=now() AND t.attempt<t.max_attempts
		  AND (t.assigned_worker='' OR (t.assigned_worker=$5 AND $5<>''))
		  AND (
			$4='any'
			OR ($4='resident_only' AND ` + laneExpr + `=$3)
			OR ($4='unresident_only' AND ($3='' OR ` + laneExpr + `<>$3))
		  )` + excludedSQL + projectSQL + roleSQL + `
		  AND NOT EXISTS (
			SELECT 1 FROM harness_chat_agent_provider_state p
			WHERE p.provider='chatgpt' AND p.paused=true
			  AND (p.paused_until IS NULL OR p.paused_until>now())
		  )
		  AND NOT ` + chatAgentBlockedByActiveTaskSQL("t") + `
		ORDER BY CASE WHEN $3<>'' AND ` + laneExpr + `=$3 THEN 0 ELSE 1 END,
		CASE
			WHEN t.priority<=1 THEN t.priority
			ELSE GREATEST(1, t.priority-LEAST(t.priority-1, FLOOR(EXTRACT(EPOCH FROM (now()-t.created_at))/900)::int))
		END, t.created_at, t.task_id
		FOR UPDATE SKIP LOCKED LIMIT 1
	)
	UPDATE harness_chat_agent_tasks t
	SET status='LEASED', lease_owner=$1, lease_expires_at=now()+($2 * interval '1 second'),
		attempt=t.attempt+1, updated_at=now()
	FROM candidate WHERE t.task_id=candidate.task_id
	RETURNING ` + qualifiedChatAgentTaskColumns("t")
	row := tx.QueryRow(query, args...)
	task, err := scanChatAgentTask(row)
	if err == sql.ErrNoRows {
		if commitErr := tx.Commit(); commitErr != nil {
			return nil, fmt.Errorf("commit empty chat agent claim: %w", commitErr)
		}
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("claim chat agent task: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit chat agent claim: %w", err)
	}
	return &task, nil
}

func (s *Store) postgresCompleteChatAgentTask(taskID, owner string, payload []byte) (ChatAgentTask, error) {
	row := s.db.QueryRow(`UPDATE harness_chat_agent_tasks
		SET status='DONE', payload=$3::jsonb, last_error='', lease_owner='', lease_expires_at=NULL, updated_at=now()
		WHERE task_id=$1 AND lease_owner=$2 AND status IN ('LEASED','RUNNING')
		RETURNING `+chatAgentTaskColumns, taskID, owner, payload)
	task, err := scanChatAgentTask(row)
	if err == sql.ErrNoRows {
		return ChatAgentTask{}, ErrChatAgentLeaseOwner
	}
	if err != nil {
		return ChatAgentTask{}, fmt.Errorf("complete chat agent task with payload: %w", err)
	}
	return task, nil
}

func (s *Store) postgresTransitionChatAgentTask(taskID, owner, status string, notBefore time.Time, detail string, observation bool) (ChatAgentTask, error) {
	// A passive observation gives back the increment the claim charged it, so
	// watching a healthy remote response for as long as it takes never spends
	// the budget reserved for real attempts. It also must not overwrite the
	// error of a real failure: see chatAgentTransitionError.
	query := `UPDATE harness_chat_agent_tasks SET status=$3,
		last_error=CASE WHEN $3='WAITING' AND $6 AND last_error <> '' THEN last_error ELSE $4 END,
		not_before=CASE WHEN $3='WAITING' THEN $5 ELSE not_before END,
		attempt=CASE WHEN $3='WAITING' AND $6 THEN GREATEST(0, attempt-1) ELSE attempt END,
		lease_owner=CASE WHEN $3='RUNNING' THEN lease_owner ELSE '' END,
		lease_expires_at=CASE WHEN $3='RUNNING' THEN lease_expires_at ELSE NULL END,
		updated_at=now()
		WHERE task_id=$1 AND lease_owner=$2 AND status IN ('LEASED','RUNNING')
		RETURNING ` + chatAgentTaskColumns
	task, err := scanChatAgentTask(s.db.QueryRow(query, taskID, owner, status, detail, notBefore, observation))
	if err == sql.ErrNoRows {
		return ChatAgentTask{}, ErrChatAgentLeaseOwner
	}
	if err != nil {
		return ChatAgentTask{}, fmt.Errorf("transition chat agent task: %w", err)
	}
	return task, nil
}

func (s *Store) postgresHeartbeatChatAgentTask(taskID, owner string, lease time.Duration) (ChatAgentTask, error) {
	seconds := int64(lease / time.Second)
	row := s.db.QueryRow(`UPDATE harness_chat_agent_tasks
		SET lease_expires_at=now()+($3 * interval '1 second'), updated_at=now()
		WHERE task_id=$1 AND lease_owner=$2 AND status IN ('LEASED','RUNNING')
		RETURNING `+chatAgentTaskColumns, taskID, owner, seconds)
	task, err := scanChatAgentTask(row)
	if err == sql.ErrNoRows {
		return ChatAgentTask{}, ErrChatAgentLeaseOwner
	}
	if err != nil {
		return ChatAgentTask{}, fmt.Errorf("heartbeat chat agent task: %w", err)
	}
	return task, nil
}

func (s *Store) postgresCancelChatAgentLineage(rootRequestID string) (int, error) {
	result, err := s.db.Exec(`UPDATE harness_chat_agent_tasks
		SET status='CANCELLED', lease_owner='', lease_expires_at=NULL, updated_at=now()
		WHERE root_request_id=$1 AND status IN ('PENDING','LEASED','RUNNING','WAITING')`, rootRequestID)
	if err != nil {
		return 0, fmt.Errorf("cancel chat agent lineage: %w", err)
	}
	count, _ := result.RowsAffected()
	return int(count), nil
}
