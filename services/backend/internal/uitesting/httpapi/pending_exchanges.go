package httpapi

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"time"

	"kernl.local/harness/backend/internal/uitesting/exchange"
)

const (
	pendingExchangeTTL = time.Hour
	maxPendingExchange = 512
)

type pendingExchange struct {
	Manifest exchange.Manifest    `json:"manifest"`
	Rules    exchange.ActionRules `json:"rules"`
	// Screenshots names the captures a guide request carried; its answer must
	// caption each of them.
	Screenshots []string  `json:"screenshots,omitempty"`
	IssuedAt    time.Time `json:"issued_at"`
}

// pendingExchanges remembers each issued request until its answer arrives, so
// an answer is validated against what was really asked. Records are also
// written to disk: a backend deploy in the middle of a run must not orphan the
// iteration whose answer is still on its way.
type pendingExchanges struct {
	mu    sync.Mutex
	dir   string
	items map[string]pendingExchange
}

func newPendingExchanges(dir string) *pendingExchanges {
	return &pendingExchanges{dir: dir, items: map[string]pendingExchange{}}
}

func pendingKey(taskID, kind string, sequence int) string {
	return taskID + "_" + kind + "_" + strconv.Itoa(sequence)
}

func (p *pendingExchanges) put(manifest exchange.Manifest, rules exchange.ActionRules, screenshots ...string) {
	kind := "guide"
	if manifest.Task == exchange.StepTask {
		kind = "step"
	}
	item := pendingExchange{Manifest: manifest, Rules: rules, Screenshots: screenshots, IssuedAt: time.Now()}
	key := pendingKey(manifest.TaskID, kind, manifest.Sequence)
	p.mu.Lock()
	defer p.mu.Unlock()
	p.prune(item.IssuedAt)
	p.items[key] = item
	if p.dir != "" && os.MkdirAll(p.dir, 0o700) == nil {
		if raw, err := json.Marshal(item); err == nil {
			_ = os.WriteFile(filepath.Join(p.dir, key+".json"), raw, 0o600)
		}
	}
}

func (p *pendingExchanges) take(key string) (pendingExchange, bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	item, ok := p.items[key]
	delete(p.items, key)
	if p.dir != "" {
		path := filepath.Join(p.dir, key+".json")
		if !ok {
			if raw, err := os.ReadFile(path); err == nil && json.Unmarshal(raw, &item) == nil && time.Since(item.IssuedAt) <= pendingExchangeTTL {
				ok = true
			}
		}
		_ = os.Remove(path)
	}
	return item, ok
}

func (p *pendingExchanges) prune(now time.Time) {
	for key, item := range p.items {
		if now.Sub(item.IssuedAt) > pendingExchangeTTL || len(p.items) >= maxPendingExchange {
			delete(p.items, key)
			if p.dir != "" {
				_ = os.Remove(filepath.Join(p.dir, key+".json"))
			}
		}
	}
}
