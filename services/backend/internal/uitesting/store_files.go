package uitesting

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func (s *Store) load(project string) (diskState, error) {
	state := diskState{Document: Document{ProjectID: project, SyncStatus: "idle", AutoRunChanges: true, Environments: []Environment{}, Tests: []TestCase{}, Runs: []Run{}, Guides: []Guide{}}, Secrets: map[string]secretPair{}}
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

func (s *Store) BeginRun(project string, run Run) (Document, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	state, err := s.load(project)
	if err != nil {
		return Document{}, err
	}
	state.Document.Runs = append([]Run{run}, state.Document.Runs...)
	if len(state.Document.Runs) > 100 {
		state.Document.Runs = state.Document.Runs[:100]
	}
	for i := range state.Document.Tests {
		if state.Document.Tests[i].ID == run.TestID {
			state.Document.Tests[i].Status = "running"
			state.Document.Tests[i].LastRunID = run.ID
		}
	}
	state.Document.UpdatedAt = time.Now().UTC()
	return state.Document, s.save(project, state)
}

func (s *Store) CompleteRun(project, runID string, result RunResult) (Document, error) {
	if !safePathComponent(runID) {
		return Document{}, fmt.Errorf("invalid ui testing run id")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	state, err := s.load(project)
	if err != nil {
		return Document{}, err
	}
	var testID string
	for i := range state.Document.Runs {
		if state.Document.Runs[i].ID == runID {
			state.Document.Runs[i].Status = result.Status
			state.Document.Runs[i].Error = result.Error
			state.Document.Runs[i].Steps = result.Steps
			state.Document.Runs[i].CompletedAt = time.Now().UTC()
			testID = state.Document.Runs[i].TestID
		}
	}
	if testID == "" {
		return Document{}, fmt.Errorf("ui testing run not found")
	}
	assetDir := filepath.Join(s.dir, "assets", projectKey(project), runID)
	if err := os.MkdirAll(assetDir, 0o700); err != nil {
		return Document{}, err
	}
	for _, shot := range result.Screenshots {
		if err := writeAsset(assetDir, shot.Name, shot.ContentBase64); err != nil {
			return Document{}, err
		}
	}
	pdfReady := false
	if result.PDFBase64 != "" {
		if err := writeAsset(assetDir, "guide.pdf", result.PDFBase64); err != nil {
			return Document{}, err
		}
		pdfReady = true
	}
	if result.GuideMD != "" {
		if err := os.WriteFile(filepath.Join(assetDir, "guide.md"), []byte(result.GuideMD), 0o600); err != nil {
			return Document{}, err
		}
	}
	guide := Guide{ID: "guide:" + testID, TestID: testID, RunID: runID, Title: result.GuideTitle, Markdown: result.GuideMD, PDFReady: pdfReady, Screenshots: result.Steps, UpdatedAt: time.Now().UTC()}
	upsertGuide(&state.Document, guide)
	for i := range state.Document.Tests {
		if state.Document.Tests[i].ID == testID {
			state.Document.Tests[i].Status = map[bool]string{true: "passed", false: "failed"}[result.Status == "passed"]
		}
	}
	state.Document.UpdatedAt = time.Now().UTC()
	return state.Document, s.save(project, state)
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
func upsertGuide(doc *Document, guide Guide) {
	for i := range doc.Guides {
		if doc.Guides[i].TestID == guide.TestID {
			doc.Guides[i] = guide
			return
		}
	}
	doc.Guides = append([]Guide{guide}, doc.Guides...)
}

func safePathComponent(value string) bool {
	return value != "" && value != "." && value != ".." && value == filepath.Base(value) && !strings.ContainsAny(value, "/\\")
}
