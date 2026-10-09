package uitesting

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

func (s *Store) load(project string) (diskState, error) {
	state := diskState{Document: Document{ProjectID: project, SyncStatus: "idle", AutoRunChanges: true}, Secrets: map[string]secretPair{}}
	normalizeDocument(&state.Document)
	raw, err := os.ReadFile(filepath.Join(s.dir, projectKey(project)+".json"))
	if os.IsNotExist(err) {
		return state, nil
	}
	if err != nil {
		return state, err
	}
	if err := json.Unmarshal(raw, &state); err != nil {
		return state, err
	}
	if state.Secrets == nil {
		state.Secrets = map[string]secretPair{}
	}
	normalizeDocument(&state.Document)
	state.Document.ProjectID = project
	return state, nil
}

func (s *Store) save(project string, state diskState) error {
	if err := os.MkdirAll(s.dir, 0o700); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	path := filepath.Join(s.dir, projectKey(project)+".json")
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func (s *Store) AssetPath(project, runID, name string) (string, error) {
	if !safePathComponent(runID) || !safePathComponent(name) {
		return "", fmt.Errorf("invalid ui testing asset")
	}
	path := filepath.Join(s.dir, "assets", projectKey(project), runID, name)
	if _, err := os.Stat(path); err != nil {
		return "", err
	}
	return path, nil
}

func writeAsset(dir, name, value string) error {
	if !safePathComponent(name) {
		return fmt.Errorf("invalid asset name")
	}
	raw, err := base64.StdEncoding.DecodeString(value)
	if err != nil {
		return err
	}
	if len(raw) > 20<<20 {
		return fmt.Errorf("ui testing asset exceeds 20 MiB")
	}
	return os.WriteFile(filepath.Join(dir, name), raw, 0o600)
}
func safePathComponent(value string) bool {
	return value != "" && value != "." && value != ".." && value == filepath.Base(value) && !strings.ContainsAny(value, "/\\")
}

// normalizeDocument gives every collection a non-nil value, so documents
// written before a field existed still serialize as arrays.
func normalizeDocument(doc *Document) {
	if doc.Environments == nil {
		doc.Environments = []Environment{}
	}
	for i := range doc.Environments {
		if doc.Environments[i].Profiles == nil {
			doc.Environments[i].Profiles = []Profile{}
		}
	}
	if doc.Tests == nil {
		doc.Tests = []TestCase{}
	}
	if doc.Runs == nil {
		doc.Runs = []Run{}
	}
	if doc.Guides == nil {
		doc.Guides = []Guide{}
	}
	if doc.Designs == nil {
		doc.Designs = []DesignRequest{}
	}
	doc.Sessions = []SessionSummary{}
}
