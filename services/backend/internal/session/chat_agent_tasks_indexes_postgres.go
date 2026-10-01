package session

import (
	"context"
	"database/sql"
	"fmt"
)

const unifiedTaskLedgerIndexesSQL = `
CREATE INDEX IF NOT EXISTS harness_tasks_project_idx
    ON harness_tasks (project_id, source, updated_at DESC, task_id);
CREATE INDEX IF NOT EXISTS harness_tasks_terminal_idx
    ON harness_tasks (updated_at)
    WHERE status IN ('DONE','FAILED','CANCELLED','COMPLETE','ARCHIVED');
CREATE INDEX IF NOT EXISTS harness_tasks_project_status_updated_idx
    ON harness_tasks (project_id, status, updated_at DESC, task_id DESC);`

func ensureUnifiedTaskLedgerIndexes(ctx context.Context, db *sql.DB) error {
	if _, err := db.ExecContext(ctx, unifiedTaskLedgerIndexesSQL); err != nil {
		return fmt.Errorf("initialize unified task ledger indexes: %w", err)
	}
	return nil
}
