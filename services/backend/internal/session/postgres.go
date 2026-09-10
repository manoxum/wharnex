package session

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"

	_ "github.com/jackc/pgx/v5/stdlib"
	"kernl.local/harness/backend/internal/domain"
)

const postgresSchema = `
CREATE TABLE IF NOT EXISTS harness_sessions (
    id text PRIMARY KEY,
    project_path text NOT NULL,
    state text NOT NULL,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    payload jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS harness_sessions_project_created_idx
    ON harness_sessions (project_path, created_at, id);
CREATE TABLE IF NOT EXISTS legacy_session_migrations (
    snapshot_sha256 text PRIMARY KEY,
    source_path text NOT NULL,
    imported_records integer NOT NULL,
    migrated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS harness_events (
    id text PRIMARY KEY,
    session_id text NOT NULL,
    type text NOT NULL,
    occurred_at timestamptz NOT NULL,
    data jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS harness_events_session_time_idx
    ON harness_events (session_id, occurred_at, id);
CREATE TABLE IF NOT EXISTS harness_project_knowledge (
    project_path text PRIMARY KEY,
    content text NOT NULL DEFAULT '',
    version integer NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by_request_id text NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS harness_project_knowledge_state (
    project_path text PRIMARY KEY,
    revision bigint NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by_request_id text NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS harness_project_knowledge_entries (
    project_path text NOT NULL,
    knowledge_id text NOT NULL,
    content text NOT NULL,
    version integer NOT NULL DEFAULT 1,
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by_request_id text NOT NULL DEFAULT '',
    PRIMARY KEY (project_path, knowledge_id)
);
CREATE INDEX IF NOT EXISTS harness_project_knowledge_entries_project_idx
    ON harness_project_knowledge_entries (project_path, knowledge_id);
CREATE TABLE IF NOT EXISTS harness_workspace_chats (
    id text PRIMARY KEY,
    project_path text NOT NULL,
    session_id text NOT NULL DEFAULT '',
    title text NOT NULL DEFAULT '',
    chatgpt_url text NOT NULL DEFAULT '',
    archived_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    payload jsonb NOT NULL DEFAULT '{}'::jsonb
);
ALTER TABLE harness_workspace_chats ADD COLUMN IF NOT EXISTS conversation_id text NOT NULL DEFAULT '';
ALTER TABLE harness_workspace_chats ADD COLUMN IF NOT EXISTS remote_project_ref text NOT NULL DEFAULT '';
ALTER TABLE harness_workspace_chats ADD COLUMN IF NOT EXISTS remote_title text NOT NULL DEFAULT '';
ALTER TABLE harness_workspace_chats ADD COLUMN IF NOT EXISTS remote_state text NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS harness_workspace_chats_project_updated_idx
    ON harness_workspace_chats (project_path, updated_at DESC, id);
CREATE INDEX IF NOT EXISTS harness_workspace_chats_conversation_idx
    ON harness_workspace_chats (conversation_id) WHERE conversation_id <> '';
CREATE TABLE IF NOT EXISTS harness_chat_items (
    chat_id text NOT NULL,
    item_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    payload jsonb NOT NULL,
    PRIMARY KEY (chat_id, item_id)
);
CREATE INDEX IF NOT EXISTS harness_chat_items_chat_created_idx
    ON harness_chat_items (chat_id, created_at, item_id);
CREATE TABLE IF NOT EXISTS harness_chat_agent_provider_state (
    provider text PRIMARY KEY,
    paused boolean NOT NULL DEFAULT false,
    paused_until timestamptz,
    reason text NOT NULL DEFAULT '',
    updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO harness_chat_agent_provider_state (provider) VALUES ('chatgpt')
    ON CONFLICT (provider) DO NOTHING;
CREATE TABLE IF NOT EXISTS harness_chat_agent_tasks (
    task_id text PRIMARY KEY,
    type text NOT NULL,
    project_id text NOT NULL DEFAULT '',
    chat_id text NOT NULL DEFAULT '',
    session_id text NOT NULL DEFAULT '',
    request_id text NOT NULL DEFAULT '',
    root_request_id text NOT NULL DEFAULT '',
    conversation_id text NOT NULL DEFAULT '',
    parent_task_id text NOT NULL DEFAULT '',
    priority integer NOT NULL,
    status text NOT NULL,
    not_before timestamptz NOT NULL DEFAULT now(),
    attempt integer NOT NULL DEFAULT 0,
    max_attempts integer NOT NULL DEFAULT 6,
    dedupe_key text NOT NULL DEFAULT '',
    lease_owner text NOT NULL DEFAULT '',
    lease_expires_at timestamptz,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    last_error text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS harness_chat_agent_tasks_ready_idx
    ON harness_chat_agent_tasks (status, not_before, priority, created_at);
CREATE INDEX IF NOT EXISTS harness_chat_agent_tasks_conversation_idx
    ON harness_chat_agent_tasks (conversation_id, status);
CREATE INDEX IF NOT EXISTS harness_chat_agent_tasks_request_idx
    ON harness_chat_agent_tasks (root_request_id, request_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS harness_chat_agent_tasks_dedupe_active_idx
    ON harness_chat_agent_tasks (dedupe_key)
    WHERE dedupe_key <> ''
      AND type NOT IN ('BOT_WRITE','RECOVERY_WRITE')
      AND status IN ('PENDING','LEASED','RUNNING','WAITING');
INSERT INTO harness_project_knowledge_entries (project_path, knowledge_id, content, version, updated_at, updated_by_request_id)
SELECT legacy.project_path, 'legacy-project-knowledge', legacy.content, GREATEST(legacy.version, 1), legacy.updated_at, legacy.updated_by_request_id
FROM harness_project_knowledge AS legacy
WHERE btrim(legacy.content) <> ''
  AND NOT EXISTS (SELECT 1 FROM harness_project_knowledge_state AS state WHERE state.project_path=legacy.project_path)
ON CONFLICT (project_path, knowledge_id) DO NOTHING;
INSERT INTO harness_project_knowledge_state (project_path, revision, updated_at, updated_by_request_id)
SELECT project_path, GREATEST(version, 1), updated_at, updated_by_request_id
FROM harness_project_knowledge
WHERE btrim(content) <> ''
ON CONFLICT (project_path) DO NOTHING;`

func NewPostgresStore(ctx context.Context, databaseURL, legacyPath string) (*Store, error) {
	if databaseURL == "" {
		return nil, errors.New("PostgreSQL database URL is required")
	}
	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		return nil, errors.New("open PostgreSQL session store: invalid database configuration")
	}
	db.SetMaxOpenConns(8)
	db.SetMaxIdleConns(4)
	if err := db.PingContext(ctx); err != nil {
		db.Close()
		return nil, errors.New("connect PostgreSQL session store: database is unavailable or rejected the credentials")
	}
	store := &Store{db: db, path: legacyPath, items: make(map[string]domain.Session)}
	if _, err := db.ExecContext(ctx, postgresSchema); err != nil {
		db.Close()
		return nil, fmt.Errorf("initialize PostgreSQL session schema: %w", err)
	}
	if err := store.migrateLegacySnapshot(ctx, legacyPath); err != nil {
		db.Close()
		return nil, err
	}
	items, err := store.postgresList()
	if err != nil {
		db.Close()
		return nil, err
	}
	for _, item := range items {
		store.items[item.ID] = item
	}
	return store, nil
}

func (s *Store) migrateLegacySnapshot(ctx context.Context, path string) error {
	if path == "" {
		return nil
	}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("read legacy session snapshot: %w", err)
	}
	digest := sha256.Sum256(data)
	digestText := hex.EncodeToString(digest[:])
	var envelope persistenceEnvelope
	if err := json.Unmarshal(data, &envelope); err != nil {
		return fmt.Errorf("decode legacy session snapshot: %w", err)
	}
	if envelope.Version != persistenceVersion {
		return fmt.Errorf("unsupported legacy session snapshot version %d", envelope.Version)
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin legacy session migration: %w", err)
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(879341221)`); err != nil {
		return fmt.Errorf("lock legacy session migration: %w", err)
	}
	var migrated bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM legacy_session_migrations WHERE snapshot_sha256 = $1)`, digestText).Scan(&migrated); err != nil {
		return fmt.Errorf("check legacy session migration: %w", err)
	}
	if migrated {
		return tx.Commit()
	}
	imported := 0
	for _, stored := range envelope.Sessions {
		item := restoreSession(stored)
		if item.ID == "" || item.ProjectPath == "" {
			continue
		}
		normalizeRestoredSession(&item)
		payload, err := json.Marshal(persistSession(item))
		if err != nil {
			return fmt.Errorf("encode legacy session %s: %w", item.ID, err)
		}
		result, err := tx.ExecContext(ctx, `INSERT INTO harness_sessions (id, project_path, state, created_at, payload) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`, item.ID, item.ProjectPath, item.State, item.CreatedAt, payload)
		if err != nil {
			return fmt.Errorf("import legacy session %s: %w", item.ID, err)
		}
		if count, _ := result.RowsAffected(); count > 0 {
			imported++
		}
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO legacy_session_migrations (snapshot_sha256, source_path, imported_records) VALUES ($1, $2, $3)`, digestText, path, imported); err != nil {
		return fmt.Errorf("record legacy session migration: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit legacy session migration: %w", err)
	}
	return nil
}

func (s *Store) postgresPut(item domain.Session) error {
	payload, err := json.Marshal(persistSession(item))
	if err != nil {
		return fmt.Errorf("encode session: %w", err)
	}
	_, err = s.db.Exec(`INSERT INTO harness_sessions (id, project_path, state, created_at, updated_at, payload) VALUES ($1, $2, $3, $4, now(), $5) ON CONFLICT (id) DO UPDATE SET project_path = EXCLUDED.project_path, state = EXCLUDED.state, created_at = EXCLUDED.created_at, updated_at = now(), payload = EXCLUDED.payload`, item.ID, item.ProjectPath, item.State, item.CreatedAt, payload)
	return wrapPostgresError("persist session", err)
}

func (s *Store) postgresDelete(id string) error {
	result, err := s.db.Exec(`DELETE FROM harness_sessions WHERE id = $1`, id)
	if err != nil {
		return wrapPostgresError("delete session", err)
	}
	if count, _ := result.RowsAffected(); count == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) postgresList() ([]domain.Session, error) {
	rows, err := s.db.Query(`SELECT payload FROM harness_sessions ORDER BY created_at, id`)
	if err != nil {
		return nil, wrapPostgresError("list sessions", err)
	}
	defer rows.Close()
	items := make([]domain.Session, 0)
	for rows.Next() {
		var payload []byte
		if err := rows.Scan(&payload); err != nil {
			return nil, wrapPostgresError("scan session", err)
		}
		item, err := decodePostgresSession(payload)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, wrapPostgresError("iterate sessions", rows.Err())
}

func (s *Store) postgresClear() error {
	_, err := s.db.Exec(`TRUNCATE harness_chat_agent_tasks, harness_events, harness_sessions`)
	return wrapPostgresError("clear sessions", err)
}

func (s *Store) AppendEvent(event domain.Event) error {
	if s.db == nil {
		return nil
	}
	data, err := json.Marshal(event.Data)
	if err != nil {
		return fmt.Errorf("encode operational event: %w", err)
	}
	_, err = s.db.Exec(`INSERT INTO harness_events (id, session_id, type, occurred_at, data) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING`, event.ID, event.SessionID, event.Type, event.Timestamp, data)
	if err != nil {
		return fmt.Errorf("persist operational event: %w", err)
	}
	return nil
}

// DeleteSessionEvents removes every audit/log event recorded for one
// session. Used by chat-archive compaction (ADR-0031) once those events
// have been folded into the session's compacted package. A no-op when
// running without Postgres, matching AppendEvent/EventHistory's existing
// guard: the in-memory store never persists events in the first place.
func (s *Store) DeleteSessionEvents(sessionID string) error {
	if s.db == nil {
		return nil
	}
	_, err := s.db.Exec(`DELETE FROM harness_events WHERE session_id = $1`, sessionID)
	return wrapPostgresError("delete session events", err)
}

func (s *Store) EventHistory(sessionID string) ([]domain.Event, error) {
	if s.db == nil {
		return nil, nil
	}
	rows, err := s.db.Query(`SELECT id, type, occurred_at, data FROM harness_events WHERE session_id=$1 ORDER BY occurred_at,id`, sessionID)
	if err != nil {
		return nil, fmt.Errorf("read operational events: %w", err)
	}
	defer rows.Close()
	var events []domain.Event
	for rows.Next() {
		var event domain.Event
		var data []byte
		event.SessionID = sessionID
		if err := rows.Scan(&event.ID, &event.Type, &event.Timestamp, &data); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(data, &event.Data); err != nil {
			return nil, err
		}
		events = append(events, event)
	}
	return events, rows.Err()
}

func decodePostgresSession(payload []byte) (domain.Session, error) {
	var stored persistedSession
	if err := json.Unmarshal(payload, &stored); err != nil {
		return domain.Session{}, fmt.Errorf("decode PostgreSQL session record: %w", err)
	}
	item := restoreSession(stored)
	normalizeRestoredSession(&item)
	return item, nil
}

func normalizeRestoredSession(item *domain.Session) {
	if item.ExecutionMode == "" {
		item.ExecutionMode = domain.ExecutionModeProtected
	}
	if item.AutomationMode == "" {
		item.AutomationMode = domain.AutomationModeManual
	}
	if interrupted := item.InterruptedExecution; interrupted != nil {
		switch interrupted.Status {
		case "", domain.InterruptedExecutionRunning, domain.InterruptedExecutionResuming:
			interrupted.Status = domain.InterruptedExecutionAwaitingDecision
		}
	}
}

func wrapPostgresError(action string, err error) error {
	if err == nil {
		return nil
	}
	return fmt.Errorf("%s in PostgreSQL: %w", action, err)
}
