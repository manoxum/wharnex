// Package pendingcommit records changes Wharnex applied to a host project but
// deliberately did not commit.
//
// In manual commit mode an applied change lands in the working tree and the
// branch returns to where the operator left it. The change is then
// indistinguishable, to Git, from anything else the operator was editing — and
// the planner-authored commit message describing it, which the change protocol
// obliges every change to carry, would simply be lost. These records keep that
// message, the paths it covers and the diff it produced, so the operator can
// commit later with the history the change deserves rather than typing
// "wip" over work they did not write.
package pendingcommit

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	// MaxDiffBytes bounds one stored diff. The diff is for the operator to
	// read before committing; the commit itself always takes the working
	// tree's real current content, so truncating display text can never
	// truncate what gets committed.
	MaxDiffBytes = 256 * 1024
	// MaxRecordsPerProject bounds the queue so a project left in manual mode
	// for months cannot grow the document without limit. The oldest records
	// are dropped first, and dropping one loses only its message: the change
	// itself is in the working tree either way.
	MaxRecordsPerProject = 200
)

// Record is one uncommitted change Wharnex applied, with the history it should
// eventually receive.
type Record struct {
	ID          string `json:"id"`
	ProjectPath string `json:"project_path"`
	SessionID   string `json:"session_id,omitempty"`
	RequestID   string `json:"request_id,omitempty"`
	PlanID      string `json:"plan_id,omitempty"`
	// Subject is the commit message's first line, kept separately so a list
	// view never has to parse the message.
	Subject string `json:"subject"`
	// Message is the full planner-authored commit message including trailers.
	Message string `json:"message"`
	// Paths are the files the change wrote, in the order the plan declared.
	Paths []string `json:"paths"`
	// Diff is the change's own unified diff at the time it was applied. It is
	// a record of what Wharnex did, not what will be committed — the operator
	// may have edited those files since.
	Diff          string    `json:"diff,omitempty"`
	DiffTruncated bool      `json:"diff_truncated,omitempty"`
	CreatedAt     time.Time `json:"created_at"`
}

// document is the on-disk shape: records grouped by canonical project path.
type document struct {
	Version  int                 `json:"version"`
	Projects map[string][]Record `json:"projects"`
}

// Store is a small file-backed queue, safe for concurrent Applies on the same
// project. Every mutation re-reads, edits and rewrites the document under one
// lock, so two chats applying at once cannot lose each other's record.
type Store struct {
	path string
	mu   sync.Mutex
}

func NewStore(path string) *Store { return &Store{path: path} }

// CanonicalKey normalizes a project path so the same project always resolves
// to one queue however the caller spelled it.
func CanonicalKey(projectPath string) string {
	trimmed := strings.TrimSpace(projectPath)
	if trimmed == "" {
		return ""
	}
	if abs, err := filepath.Abs(trimmed); err == nil {
		return filepath.Clean(abs)
	}
	return filepath.Clean(trimmed)
}

// List returns one project's pending records, oldest first.
func (s *Store) List(projectPath string) ([]Record, error) {
	if s == nil {
		return nil, nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	doc, err := s.read()
	if err != nil {
		return nil, err
	}
	return append([]Record(nil), doc.Projects[CanonicalKey(projectPath)]...), nil
}

// Append adds one record to the end of a project's queue.
func (s *Store) Append(record Record) error {
	if s == nil {
		return errors.New("pending commit store is not configured")
	}
	if strings.TrimSpace(record.ID) == "" || strings.TrimSpace(record.ProjectPath) == "" {
		return errors.New("a pending commit needs an id and a project path")
	}
	if len(record.Diff) > MaxDiffBytes {
		record.Diff = record.Diff[:MaxDiffBytes]
		record.DiffTruncated = true
	}
	if record.CreatedAt.IsZero() {
		record.CreatedAt = time.Now().UTC()
	}
	record.Subject = firstLine(record.Message)
	s.mu.Lock()
	defer s.mu.Unlock()
	doc, err := s.read()
	if err != nil {
		return err
	}
	key := CanonicalKey(record.ProjectPath)
	records := append(doc.Projects[key], record)
	if len(records) > MaxRecordsPerProject {
		records = records[len(records)-MaxRecordsPerProject:]
	}
	doc.Projects[key] = records
	return s.write(doc)
}

// Remove drops records by id, returning how many were actually present.
func (s *Store) Remove(projectPath string, ids []string) (int, error) {
	if s == nil || len(ids) == 0 {
		return 0, nil
	}
	dropping := make(map[string]bool, len(ids))
	for _, id := range ids {
		dropping[id] = true
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	doc, err := s.read()
	if err != nil {
		return 0, err
	}
	key := CanonicalKey(projectPath)
	kept := make([]Record, 0, len(doc.Projects[key]))
	removed := 0
	for _, record := range doc.Projects[key] {
		if dropping[record.ID] {
			removed++
			continue
		}
		kept = append(kept, record)
	}
	if removed == 0 {
		return 0, nil
	}
	if len(kept) == 0 {
		delete(doc.Projects, key)
	} else {
		doc.Projects[key] = kept
	}
	return removed, s.write(doc)
}

func (s *Store) read() (document, error) {
	doc := document{Version: 1, Projects: map[string][]Record{}}
	raw, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return doc, nil
	}
	if err != nil {
		return document{}, fmt.Errorf("read pending commits: %w", err)
	}
	var stored document
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&stored); err != nil {
		return document{}, fmt.Errorf("decode pending commits: %w", err)
	}
	if stored.Projects == nil {
		stored.Projects = map[string][]Record{}
	}
	stored.Version = 1
	return stored, nil
}

func (s *Store) write(doc document) error {
	if strings.TrimSpace(s.path) == "" {
		return errors.New("pending commit store is not configured")
	}
	dir := filepath.Dir(s.path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("create pending commit directory: %w", err)
	}
	tmp, err := os.CreateTemp(dir, ".git-pending-commits-*.json")
	if err != nil {
		return err
	}
	name := tmp.Name()
	defer os.Remove(name)
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		return err
	}
	encoder := json.NewEncoder(tmp)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(doc); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(name, s.path)
}

func firstLine(message string) string {
	line, _, _ := strings.Cut(strings.TrimSpace(message), "\n")
	return strings.TrimSpace(line)
}
