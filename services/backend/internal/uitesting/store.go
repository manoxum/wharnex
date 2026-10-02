package uitesting

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"sync"
	"time"
)

type secretPair struct {
	Username string `json:"username"`
	Password string `json:"password"`
}
type diskState struct {
	Document Document              `json:"document"`
	Secrets  map[string]secretPair `json:"secrets"`
}

type Store struct {
	mu  sync.Mutex
	dir string
	box *cipherBox
}

func NewStore(dir string) (*Store, error) {
	box, err := loadCipherBox(dir)
	if err != nil {
		return nil, err
	}
	return &Store{dir: dir, box: box}, nil
}

func projectKey(project string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(project)))
	return hex.EncodeToString(sum[:16])
}
func profileKey(environmentID, profileID string) string { return environmentID + "\x00" + profileID }

func (s *Store) Load(project string) (Document, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	state, err := s.load(project)
	return state.Document, err
}

func (s *Store) SaveDiscovery(project string, discovery Discovery) (Document, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	state, err := s.load(project)
	if err != nil {
		return Document{}, err
	}
	oldEnv := map[string]Environment{}
	for _, env := range state.Document.Environments {
		oldEnv[env.ID] = env
	}
	for i := range discovery.Environments {
		if old, ok := oldEnv[discovery.Environments[i].ID]; ok {
			discovery.Environments[i].URL = old.URL
			configured := map[string]bool{}
			for _, p := range old.Profiles {
				configured[p.ID] = p.Configured
			}
			for j := range discovery.Environments[i].Profiles {
				discovery.Environments[i].Profiles[j].Configured = configured[discovery.Environments[i].Profiles[j].ID]
			}
		}
	}
	for i := range discovery.Tests {
		discovery.Tests[i].Status = "ready"
	}
	state.Document.ContextSHA256 = discovery.ContextSHA256
	state.Document.SyncStatus = "ready"
	state.Document.SyncTaskID = ""
	state.Document.Environments = discovery.Environments
	state.Document.Tests = discovery.Tests
	state.Document.UpdatedAt = time.Now().UTC()
	return state.Document, s.save(project, state)
}

func (s *Store) SetSyncing(project, taskID string) (Document, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	state, err := s.load(project)
	if err != nil {
		return Document{}, err
	}
	state.Document.SyncStatus = "syncing"
	state.Document.SyncTaskID = taskID
	state.Document.UpdatedAt = time.Now().UTC()
	return state.Document, s.save(project, state)
}

func (s *Store) Configure(project, envID, profileID, url, username, password string) (Document, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	state, err := s.load(project)
	if err != nil {
		return Document{}, err
	}
	if (username == "") != (password == "") {
		return Document{}, errors.New("username and password must be configured together")
	}
	environmentFound := false
	profileFound := profileID == ""
	for i := range state.Document.Environments {
		if state.Document.Environments[i].ID != envID {
			continue
		}
		environmentFound = true
		if strings.TrimSpace(url) != "" {
			state.Document.Environments[i].URL = strings.TrimSpace(url)
		}
		for j := range state.Document.Environments[i].Profiles {
			if state.Document.Environments[i].Profiles[j].ID == profileID {
				profileFound = true
				if username != "" {
					state.Document.Environments[i].Profiles[j].Configured = true
				}
			}
		}
	}
	if !environmentFound {
		return Document{}, errors.New("ui testing environment not found")
	}
	if !profileFound {
		return Document{}, errors.New("ui testing profile not found")
	}
	if profileID != "" && username != "" {
		u, err := s.box.seal(username)
		if err != nil {
			return Document{}, err
		}
		p, err := s.box.seal(password)
		if err != nil {
			return Document{}, err
		}
		state.Secrets[profileKey(envID, profileID)] = secretPair{Username: u, Password: p}
	}
	state.Document.UpdatedAt = time.Now().UTC()
	return state.Document, s.save(project, state)
}

func (s *Store) Credentials(project, envID, profileID string) (Credentials, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	state, err := s.load(project)
	if err != nil {
		return Credentials{}, err
	}
	pair, ok := state.Secrets[profileKey(envID, profileID)]
	if !ok {
		return Credentials{}, errors.New("ui testing credentials are not configured")
	}
	u, err := s.box.open(pair.Username)
	if err != nil {
		return Credentials{}, err
	}
	p, err := s.box.open(pair.Password)
	if err != nil {
		return Credentials{}, err
	}
	return Credentials{Username: u, Password: p}, nil
}
