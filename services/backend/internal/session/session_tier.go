package session

import (
	"container/list"
	"encoding/json"
	"fmt"

	"kernl.local/harness/backend/internal/domain"
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
	defaultHotSessionBytes = 64 << 20
)

// slimSessionProjection is the SQL form of slimSession: it strips the same
// heavy fields server-side so startup neither transfers nor decodes them.
const slimSessionProjection = `payload - '_request_knowledge' - 'baseline_file_snapshots' #- '{context,manifest,files}'`

// slimSession drops the fields that dominate a session's size and that only
// request preparation, baseline reconciliation and knowledge review read.
// Those paths reach a session through Get/Update, which always hydrate.
func slimSession(item domain.Session) domain.Session {
	item.Context.Manifest.Files = nil
	item.RequestKnowledge = nil
	item.BaselineFileSnapshots = nil
	return item
}

type hotSession struct {
	id    string
	bytes int64
}

// sessionTier tracks which resident sessions are whole. It is guarded by the
// owning Store's mutex held for writing, which is why a tiered Get takes the
// exclusive lock: even a hit reorders the recency list.
type sessionTier struct {
	enabled  bool
	maxItems int
	maxBytes int64
	bytes    int64
	order    *list.List
	index    map[string]*list.Element
}

func newSessionTier(enabled bool) *sessionTier {
	return &sessionTier{enabled: enabled, maxItems: defaultHotSessionLimit, maxBytes: defaultHotSessionBytes, order: list.New(), index: make(map[string]*list.Element)}
}

func (t *sessionTier) isHot(id string) bool {
	if t == nil || !t.enabled {
		return true
	}
	_, ok := t.index[id]
	return ok
}

// promote marks id whole and returns the ids that must be demoted to stay
// within the item and byte budgets. The promoted id is never demoted by its
// own promotion.
func (t *sessionTier) promote(id string, bytes int64) []string {
	if t == nil || !t.enabled {
		return nil
	}
	t.forget(id)
	t.index[id] = t.order.PushFront(&hotSession{id: id, bytes: bytes})
	t.bytes += bytes
	var demoted []string
	for t.order.Len() > 1 && (t.order.Len() > t.maxItems || t.bytes > t.maxBytes) {
		oldest := t.order.Back()
		entry := oldest.Value.(*hotSession)
		t.forget(entry.id)
		demoted = append(demoted, entry.id)
	}
	return demoted
}

func (t *sessionTier) touch(id string) {
	if t == nil || !t.enabled {
		return
	}
	if element, ok := t.index[id]; ok {
		t.order.MoveToFront(element)
	}
}

func (t *sessionTier) forget(id string) {
	if t == nil {
		return
	}
	if element, ok := t.index[id]; ok {
		t.bytes -= element.Value.(*hotSession).bytes
		t.order.Remove(element)
		delete(t.index, id)
	}
}

func (t *sessionTier) reset() {
	if t == nil {
		return
	}
	t.bytes = 0
	t.order.Init()
	t.index = make(map[string]*list.Element)
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

// keepWholeLocked stores item as a whole resident session and demotes the
// least recently used ones beyond the budget to their slim view.
func (s *Store) keepWholeLocked(item domain.Session, bytes int64) {
	s.items[item.ID] = item
	for _, id := range s.tier.promote(item.ID, bytes) {
		if demoted, ok := s.items[id]; ok {
			s.items[id] = slimSession(demoted)
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
	rows, err := s.db.Query(`SELECT ` + slimSessionProjection + ` FROM harness_sessions ORDER BY created_at, id`)
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
		items = append(items, slimSession(item))
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
