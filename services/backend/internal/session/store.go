package session

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"kernl.local/harness/backend/internal/domain"
)

var ErrNotFound = errors.New("session not found")

const persistenceVersion = 1

type persistenceEnvelope struct {
	Version  int                `json:"version"`
	Sessions []persistedSession `json:"sessions"`
}

// persistedSession keeps server-only artifact locations durable without ever
// exposing them through the public domain.Session JSON representation.
type persistedSession struct {
	domain.Session
	RequestContextArchives             map[string]string                          `json:"_request_context_archives,omitempty"`
	RequestSupportArtifacts            map[string][]domain.RequestSupportArtifact `json:"_request_support_artifacts,omitempty"`
	RequestKnowledge                   map[string]domain.RequestKnowledgeSnapshot `json:"_request_knowledge,omitempty"`
	PendingKnowledgeRootRequestID      string                                     `json:"_pending_knowledge_root_request_id,omitempty"`
	PendingKnowledgeCandidateRequestID string                                     `json:"_pending_knowledge_candidate_request_id,omitempty"`
	PendingKnowledgeCandidate          *domain.ProjectKnowledgeCandidate          `json:"_pending_knowledge_candidate,omitempty"`
	PendingKnowledgeSummary            string                                     `json:"_pending_knowledge_summary,omitempty"`
	ArtifactObjectKeys                 map[string]string                          `json:"_artifact_object_keys,omitempty"`
	ArchivePackageObjectKey            string                                     `json:"_archive_package_object_key,omitempty"`
}

func persistSession(item domain.Session) persistedSession {
	keys := make(map[string]string, len(item.Artifacts))
	for _, artifact := range item.Artifacts {
		if artifact.ID != "" && artifact.ObjectKey != "" {
			keys[artifact.ID] = artifact.ObjectKey
		}
	}
	stored := persistedSession{
		Session: item, RequestContextArchives: item.RequestContextArchives, RequestSupportArtifacts: item.RequestSupportArtifacts, RequestKnowledge: item.RequestKnowledge,
		PendingKnowledgeRootRequestID: item.PendingKnowledgeRootRequestID, PendingKnowledgeCandidateRequestID: item.PendingKnowledgeCandidateRequestID,
		PendingKnowledgeCandidate: item.PendingKnowledgeCandidate, PendingKnowledgeSummary: item.PendingKnowledgeSummary,
		ArtifactObjectKeys: keys,
	}
	if item.ArchivePackage != nil {
		stored.ArchivePackageObjectKey = item.ArchivePackage.ObjectKey
	}
	return stored
}

func restoreSession(item persistedSession) domain.Session {
	result := item.Session
	result.RequestContextArchives = item.RequestContextArchives
	result.RequestSupportArtifacts = item.RequestSupportArtifacts
	result.RequestKnowledge = item.RequestKnowledge
	result.PendingKnowledgeRootRequestID = item.PendingKnowledgeRootRequestID
	result.PendingKnowledgeCandidateRequestID = item.PendingKnowledgeCandidateRequestID
	result.PendingKnowledgeCandidate = item.PendingKnowledgeCandidate
	result.PendingKnowledgeSummary = item.PendingKnowledgeSummary
	for index := range result.Artifacts {
		result.Artifacts[index].ObjectKey = item.ArtifactObjectKeys[result.Artifacts[index].ID]
	}
	if result.ArchivePackage != nil {
		result.ArchivePackage.ObjectKey = item.ArchivePackageObjectKey
	}
	externalizeLegacyConflictCapsule(&result)
	return result
}

// externalizeLegacyConflictCapsule upgrades conflict requests persisted by the
// pre-file-first implementation. Those sessions can survive an engine update
// with a multi-megabyte capsule still embedded in LastManualPrompt, causing
// Desktop to repeat "Prepared prompt exceeds 1 MiB" forever. The migration is
// deliberately narrow: it accepts only a valid harness.conflict/v1 object for
// the active conflict and moves exactly that JSON object to the fixed request
// artifact path.
func externalizeLegacyConflictCapsule(item *domain.Session) {
	if item == nil || item.IntegrationConflict == nil || item.IntegrationConflict.RequestID == "" {
		return
	}
	const marker = "\n\nCONFLICT CAPSULE:\n"
	start := strings.Index(item.LastManualPrompt, marker)
	if start < 0 {
		return
	}
	jsonStart := start + len(marker)
	decoder := json.NewDecoder(strings.NewReader(item.LastManualPrompt[jsonStart:]))
	var raw json.RawMessage
	if err := decoder.Decode(&raw); err != nil || len(raw) == 0 {
		return
	}
	var identity struct {
		Protocol   string `json:"protocol"`
		ConflictID string `json:"conflict_id"`
	}
	if json.Unmarshal(raw, &identity) != nil || identity.Protocol != "harness.conflict/v1" || identity.ConflictID != item.IntegrationConflict.ID {
		return
	}
	requestID := item.IntegrationConflict.RequestID
	if item.RequestSupportArtifacts == nil {
		item.RequestSupportArtifacts = make(map[string][]domain.RequestSupportArtifact)
	}
	item.RequestSupportArtifacts[requestID] = []domain.RequestSupportArtifact{{Path: "conflict/capsule.json", Content: append([]byte(nil), raw...)}}
	jsonEnd := jsonStart + int(decoder.InputOffset())
	item.LastManualPrompt = item.LastManualPrompt[:start] + "\n\nThe complete conflict capsule is attached at conflict/capsule.json inside the single request ZIP. Read that authoritative file before authoring the resolution." + item.LastManualPrompt[jsonEnd:]
}

type Store struct {
	mu    sync.RWMutex
	items map[string]domain.Session
	path  string
	db    *sql.DB
	// knowledge is the in-memory fallback for ProjectKnowledge, used only
	// when db is nil (tests/dev). Production always runs with a Postgres
	// store (see cmd/harness/main.go), where harness_project_knowledge is
	// authoritative instead. Lazily initialized: see knowledge.go.
	knowledge map[string]domain.ProjectKnowledge
	// knowledgeCatalogs is the v2 in-memory fallback. Postgres persists the
	// same model in harness_project_knowledge_state/entries.
	knowledgeCatalogs map[string]domain.ProjectKnowledgeCatalog
	// workspaceChats / workspaceChatItems are the in-memory fallbacks for the
	// chat index and transcripts, used only when db is nil. Postgres persists
	// the same model in harness_workspace_chats / harness_chat_items, which is
	// where this state belongs: it previously lived in the browser's
	// localStorage, where a single "clear data" destroyed every chat title,
	// ordering, conversation binding and transcript while the sessions and
	// their artifacts survived untouched. Lazily initialized: see
	// workspacechats.go.
	workspaceChats     map[string][]domain.WorkspaceChat
	workspaceChatItems map[string][]domain.WorkspaceChatItem
	// projectTodos is the non-Postgres fallback for the durable project TODO
	// inbox. Production persists the same records in harness_project_todos.
	projectTodos map[string][]domain.ProjectTodo
	// chatAgentTasks is the non-Postgres fallback for the durable browser job
	// scheduler. Production persists the same records in
	// harness_chat_agent_tasks.
	chatAgentTasks             map[string]ChatAgentTask
	chatAgentProvider          ChatAgentProviderState
	chatAgentProcessingSamples []ChatAgentProcessingSample
}

func NewStore() *Store {
	return &Store{items: make(map[string]domain.Session), projectTodos: make(map[string][]domain.ProjectTodo)}
}

func NewPersistentStore(path string) (*Store, error) {
	cleaned := ""
	if path != "" {
		cleaned = filepath.Clean(path)
	}
	store := &Store{items: make(map[string]domain.Session), projectTodos: make(map[string][]domain.ProjectTodo), path: cleaned}
	if err := store.load(); err != nil {
		return nil, err
	}
	return store, nil
}

func (s *Store) Put(item domain.Session) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db != nil {
		if err := s.postgresPut(item); err != nil {
			return err
		}
		s.items[item.ID] = item
		return nil
	}
	s.items[item.ID] = item
	if err := s.persistLocked(); err != nil {
		delete(s.items, item.ID)
		return err
	}
	return nil
}

func (s *Store) Get(id string) (domain.Session, error) {
	s.mu.RLock()
	item, ok := s.items[id]
	s.mu.RUnlock()
	if !ok {
		return domain.Session{}, ErrNotFound
	}
	return item, nil
}

func (s *Store) Delete(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	item, ok := s.items[id]
	if !ok {
		return ErrNotFound
	}
	if s.db != nil {
		if err := s.postgresDelete(id); err != nil {
			return err
		}
		delete(s.items, id)
		return nil
	}
	delete(s.items, id)
	if err := s.persistLocked(); err != nil {
		s.items[id] = item
		return err
	}
	return nil
}

func (s *Store) Update(id string, fn func(*domain.Session) error) (domain.Session, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	item, ok := s.items[id]
	if !ok {
		return domain.Session{}, ErrNotFound
	}
	original := item
	if err := fn(&item); err != nil {
		return domain.Session{}, err
	}
	if s.db != nil {
		if err := s.postgresPut(item); err != nil {
			return domain.Session{}, err
		}
		s.items[id] = item
		return item, nil
	}
	s.items[id] = item
	if err := s.persistLocked(); err != nil {
		s.items[id] = original
		return domain.Session{}, err
	}
	return item, nil
}

func (s *Store) List() []domain.Session {
	s.mu.RLock()
	defer s.mu.RUnlock()
	items := make([]domain.Session, 0, len(s.items))
	for _, item := range s.items {
		items = append(items, item)
	}
	sort.Slice(items, func(i, j int) bool { return items[i].CreatedAt.Before(items[j].CreatedAt) })
	return items
}

func (s *Store) Path() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.path
}

func (s *Store) StateBytes() int64 {
	if s == nil {
		return 0
	}
	if s.db != nil {
		var bytes int64
		if err := s.db.QueryRow(`SELECT pg_database_size(current_database())`).Scan(&bytes); err == nil {
			return bytes
		}
		return 0
	}
	info, err := os.Stat(s.Path())
	if err != nil || !info.Mode().IsRegular() {
		return 0
	}
	return info.Size()
}

func (s *Store) Clear() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db != nil {
		if err := s.postgresClear(); err != nil {
			return err
		}
		s.items = make(map[string]domain.Session)
		return nil
	}
	original := s.items
	s.items = make(map[string]domain.Session)
	if err := s.persistLocked(); err != nil {
		s.items = original
		return err
	}
	return nil
}

func (s *Store) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

func (s *Store) load() error {
	if s.path == "" {
		return nil
	}
	data, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("read session state: %w", err)
	}
	var envelope persistenceEnvelope
	if err := json.Unmarshal(data, &envelope); err != nil {
		return fmt.Errorf("decode session state: %w", err)
	}
	if envelope.Version != persistenceVersion {
		return fmt.Errorf("unsupported session state version %d", envelope.Version)
	}
	for _, stored := range envelope.Sessions {
		item := restoreSession(stored)
		if item.ID == "" || item.ProjectPath == "" {
			continue
		}
		normalizeRestoredSession(&item)
		s.items[item.ID] = item
	}
	return nil
}

func (s *Store) persistLocked() error {
	if s.path == "" {
		return nil
	}
	items := make([]persistedSession, 0, len(s.items))
	for _, item := range s.items {
		items = append(items, persistSession(item))
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Session.CreatedAt.Before(items[j].Session.CreatedAt) })
	data, err := json.MarshalIndent(persistenceEnvelope{Version: persistenceVersion, Sessions: items}, "", "  ")
	if err != nil {
		return fmt.Errorf("encode session state: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		return fmt.Errorf("create session state directory: %w", err)
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, append(data, '\n'), 0o600); err != nil {
		return fmt.Errorf("write session state: %w", err)
	}
	if err := os.Rename(tmp, s.path); err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("replace session state: %w", err)
	}
	return nil
}
