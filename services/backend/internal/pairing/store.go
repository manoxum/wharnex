package pairing

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"time"
)

const (
	pendingLifetime = 5 * time.Minute
	sessionLifetime = 30 * 24 * time.Hour
)

type pendingPair struct {
	ExpiresAt time.Time
}

type sessionRecord struct {
	TokenHash string    `json:"token_hash"`
	CreatedAt time.Time `json:"created_at"`
	ExpiresAt time.Time `json:"expires_at"`
}

type document struct {
	Version  int             `json:"version"`
	Sessions []sessionRecord `json:"sessions"`
}

type Store struct {
	path    string
	now     func() time.Time
	mu      sync.Mutex
	pending map[string]pendingPair
}

func NewStore(path string) *Store {
	return &Store{path: path, now: time.Now, pending: make(map[string]pendingPair)}
}

func (s *Store) Begin() (string, time.Time, error) {
	code, err := randomToken(24)
	if err != nil {
		return "", time.Time{}, err
	}
	now := s.now().UTC()
	expires := now.Add(pendingLifetime)
	s.mu.Lock()
	defer s.mu.Unlock()
	for key, item := range s.pending {
		if !item.ExpiresAt.After(now) {
			delete(s.pending, key)
		}
	}
	s.pending[hash(code)] = pendingPair{ExpiresAt: expires}
	return code, expires, nil
}

func (s *Store) Claim(code string) (string, error) {
	if code == "" {
		return "", errors.New("pairing code is required")
	}
	now := s.now().UTC()
	s.mu.Lock()
	defer s.mu.Unlock()
	key := hash(code)
	item, exists := s.pending[key]
	if !exists || !item.ExpiresAt.After(now) {
		delete(s.pending, key)
		return "", errors.New("pairing code is invalid or expired")
	}
	delete(s.pending, key)
	token, err := randomToken(32)
	if err != nil {
		return "", err
	}
	doc, err := s.loadLocked()
	if err != nil {
		return "", err
	}
	doc.Sessions = activeSessions(doc.Sessions, now)
	doc.Sessions = append(doc.Sessions, sessionRecord{TokenHash: hash(token), CreatedAt: now, ExpiresAt: now.Add(sessionLifetime)})
	if len(doc.Sessions) > 32 {
		doc.Sessions = append([]sessionRecord(nil), doc.Sessions[len(doc.Sessions)-32:]...)
	}
	if err := s.saveLocked(doc); err != nil {
		return "", err
	}
	return token, nil
}

func (s *Store) Authenticate(token string) bool {
	if token == "" {
		return false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	doc, err := s.loadLocked()
	if err != nil {
		return false
	}
	now := s.now().UTC()
	candidate := hash(token)
	for _, item := range doc.Sessions {
		if item.TokenHash == candidate && item.ExpiresAt.After(now) {
			return true
		}
	}
	return false
}

func (s *Store) Revoke(token string) error {
	if token == "" {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	doc, err := s.loadLocked()
	if err != nil {
		return err
	}
	candidate := hash(token)
	kept := doc.Sessions[:0]
	for _, item := range doc.Sessions {
		if item.TokenHash != candidate {
			kept = append(kept, item)
		}
	}
	doc.Sessions = kept
	return s.saveLocked(doc)
}

func (s *Store) loadLocked() (document, error) {
	doc := document{Version: 1, Sessions: []sessionRecord{}}
	if s.path == "" {
		return doc, nil
	}
	raw, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return doc, nil
	}
	if err != nil {
		return document{}, err
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		return document{}, err
	}
	if doc.Version != 1 {
		return document{}, errors.New("unsupported pairing state version")
	}
	if doc.Sessions == nil {
		doc.Sessions = []sessionRecord{}
	}
	return doc, nil
}

func (s *Store) saveLocked(doc document) error {
	if s.path == "" {
		return errors.New("pairing state file is not configured")
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		return err
	}
	temporary := s.path + ".tmp"
	if err := os.WriteFile(temporary, raw, 0o600); err != nil {
		return err
	}
	return os.Rename(temporary, s.path)
}
