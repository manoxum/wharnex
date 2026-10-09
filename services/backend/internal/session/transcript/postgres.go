package transcript

import (
	"database/sql"
	"encoding/json"
	"fmt"

	"kernl.local/harness/backend/internal/domain"
)

type queryer interface {
	Query(string, ...any) (*sql.Rows, error)
}

func List(db queryer, chatID string) ([]domain.WorkspaceChatItem, error) {
	rows, err := db.Query(`SELECT item_id, chat_id, created_at, payload FROM harness_chat_items
		WHERE chat_id=$1 ORDER BY created_at, item_id`, chatID)
	if err != nil {
		return nil, fmt.Errorf("list workspace chat items: %w", err)
	}
	defer rows.Close()
	items := make([]domain.WorkspaceChatItem, 0, 64)
	for rows.Next() {
		var item domain.WorkspaceChatItem
		var payload []byte
		if err := rows.Scan(&item.ID, &item.ChatID, &item.CreatedAt, &payload); err != nil {
			return nil, fmt.Errorf("scan workspace chat item: %w", err)
		}
		if err := json.Unmarshal(payload, &item.Payload); err != nil {
			return nil, fmt.Errorf("decode workspace chat item: %w", err)
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func Write(db *sql.DB, chatID string, items []domain.WorkspaceChatItem, appendOnly bool) error {
	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("begin transcript write: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	// Append and renderer replacement share one transaction-scoped chat lock.
	// The snapshot read and write cannot interleave across backend processes.
	if _, err := tx.Exec(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, "wharnex-transcript:"+chatID); err != nil {
		return fmt.Errorf("lock transcript: %w", err)
	}
	previous, err := List(tx, chatID)
	if err != nil {
		return err
	}
	merged := Merge(previous, items, appendOnly)
	// Delete only rows absent from the final merge; existing row identities
	// survive upserts and backend-authored history survives stale replacements.
	keep := make([]string, 0, len(merged))
	for _, item := range merged {
		keep = append(keep, item.ID)
		payload, err := json.Marshal(item.Payload)
		if err != nil {
			return fmt.Errorf("encode chat item: %w", err)
		}
		if _, err := tx.Exec(`INSERT INTO harness_chat_items (chat_id,item_id,created_at,payload) VALUES ($1,$2,$3,$4)
			ON CONFLICT (chat_id,item_id) DO UPDATE SET created_at=EXCLUDED.created_at,payload=EXCLUDED.payload`, chatID, item.ID, item.CreatedAt, payload); err != nil {
			return fmt.Errorf("persist chat item: %w", err)
		}
	}
	if _, err := tx.Exec(`DELETE FROM harness_chat_items WHERE chat_id=$1 AND NOT (item_id=ANY($2::text[]))`, chatID, keep); err != nil {
		return fmt.Errorf("remove superseded transcript items: %w", err)
	}
	return tx.Commit()
}
