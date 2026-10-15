package session

import (
	"encoding/json"
	"fmt"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/session/residency"
)

// Session residency tiers for the PostgreSQL-backed store.
//
// The store used to keep every session ever created fully decoded in memory.
// A session carries its whole context manifest, one knowledge snapshot per
// request and one file-hash map per baseline, so a long-lived installation
// (1.5k sessions, ~1 GiB of JSON) held gigabytes of heap for chats nobody had
// opened in weeks. Every session now stays resident only as a slim scan view;
// a bounded, least-recently-used set is kept whole. Get and Update hydrate a
// slim entry from PostgreSQL on demand, so what they return is always the
// complete session, and a write can never persist a slim view over the
// durable record.
const (
	defaultHotSessionLimit = 24
	// Decoded maps cost substantially more than their serialized payload.
	// Reserve headroom for live execution rather than retaining 64 MiB of JSON.
	defaultHotSessionBytes = 16 << 20
)

// sessionTier adapts Store admission to the domain-owned LRU tracker. Store
// callers hold its write mutex while promotion and value demotion happen.
type sessionTier struct {
	enabled  bool
	maxItems int
	maxBytes int64
	cache    *residency.Cache
}

func newSessionTier(enabled bool) *sessionTier {
	t := &sessionTier{enabled: enabled, maxItems: defaultHotSessionLimit, maxBytes: defaultHotSessionBytes}
	if enabled {
		t.cache = residency.New(t.maxItems, t.maxBytes)
	}
	return t
}

func (t *sessionTier) isHot(id string) bool {
	return t == nil || t.cache.Hot(id)
}
func (t *sessionTier) promote(id string, bytes int64) []string {
	if t == nil || !t.enabled {
		return nil
	}
	t.cache.SetLimits(t.maxItems, t.maxBytes)
	return t.cache.Promote(id, bytes)
}
func (t *sessionTier) touch(id string) {
	if t != nil {
		t.cache.Touch(id)
	}
}
func (t *sessionTier) forget(id string) {
	if t != nil {
		t.cache.Forget(id)
	}
}
func (t *sessionTier) reset() {
	if t != nil {
		t.cache.Reset()
	}
}

// residentLocked returns id's whole session, hydrating it from PostgreSQL when
// only its slim view is resident. The caller holds s.mu for writing.
func (s *Store) residentLocked(id string) (domain.Session, error) {
	item, ok := s.items[id]
	if !ok {
		return domain.Session{}, ErrNotFound
	}
	if s.tier.isHot(id) {
		s.tier.touch(id)
		return item, nil
	}
	payload, err := s.postgresPayload(id)
	if err != nil {
		return domain.Session{}, err
	}
	full, err := decodePostgresSession(payload)
	if err != nil {
		return domain.Session{}, err
	}
	s.keepWholeLocked(full, int64(len(payload)))
	return full, nil
}

// keepWholeLocked admits fitting aggregates and demotes evictions or an
// oversized candidate to its slim view. The caller still owns the full value.
func (s *Store) keepWholeLocked(item domain.Session, bytes int64) {
	s.items[item.ID] = item
	for _, id := range s.tier.promote(item.ID, bytes) {
		if demoted, ok := s.items[id]; ok {
			s.items[id] = residency.Slim(demoted)
		}
	}
}

func (s *Store) postgresPayload(id string) ([]byte, error) {
	var payload []byte
	if err := s.db.QueryRow(`SELECT payload FROM harness_sessions WHERE id = $1`, id).Scan(&payload); err != nil {
		return nil, fmt.Errorf("hydrate session %s: %w", id, wrapPostgresError("load session", err))
	}
	return payload, nil
}

// postgresListSlim loads every session's slim view for startup residency.
func (s *Store) postgresListSlim() ([]domain.Session, error) {
	rows, err := s.db.Query(`SELECT ` + residency.Projection + ` FROM harness_sessions ORDER BY created_at, id`)
	if err != nil {
		return nil, wrapPostgresError("list sessions", err)
	}
	defer rows.Close()
	items := make([]domain.Session, 0, 256)
	for rows.Next() {
		var payload []byte
		if err := rows.Scan(&payload); err != nil {
			return nil, wrapPostgresError("scan session", err)
		}
		item, err := decodePostgresSession(payload)
		if err != nil {
			return nil, err
		}
		items = append(items, residency.Slim(item))
	}
	return items, wrapPostgresError("iterate sessions", rows.Err())
}

// postgresPut writes the whole session and reports the size of the stored
// payload, which is what the resident budget is measured in.
func (s *Store) postgresPut(item domain.Session) (int64, error) {
	payload, err := json.Marshal(persistSession(item))
	if err != nil {
		return 0, fmt.Errorf("encode session: %w", err)
	}
	_, err = s.db.Exec(`INSERT INTO harness_sessions (id, project_path, state, created_at, updated_at, payload) VALUES ($1, $2, $3, $4, now(), $5) ON CONFLICT (id) DO UPDATE SET project_path = EXCLUDED.project_path, state = EXCLUDED.state, created_at = EXCLUDED.created_at, updated_at = now(), payload = EXCLUDED.payload`, item.ID, item.ProjectPath, item.State, item.CreatedAt, payload)
	return int64(len(payload)), wrapPostgresError("persist session", err)
}
