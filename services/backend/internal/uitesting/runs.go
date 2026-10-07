package uitesting

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

const (
	// GuideDocumentAsset is the structured guide stored beside a run's captures.
	GuideDocumentAsset = "guide.json"
	RunRoleTarget      = "target"
	RunRoleDependency  = "dependency"
	maxRunHistory      = 100
)

// BeginRun records queued runs — the selected test and every prerequisite its
// chain will execute — without claiming they have started.
func (s *Store) BeginRun(project string, runs ...Run) (Document, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	state, err := s.load(project)
	if err != nil {
		return Document{}, err
	}
	for _, run := range runs {
		state.Document.Runs = append([]Run{run}, state.Document.Runs...)
		markTest(&state.Document, run.TestID, run.Status, run.ID)
	}
	if len(state.Document.Runs) > maxRunHistory {
		state.Document.Runs = state.Document.Runs[:maxRunHistory]
	}
	state.Document.UpdatedAt = time.Now().UTC()
	return state.Document, s.save(project, state)
}

// CompleteRun stores a run outcome. A run the worker started on its own — a
// prerequisite re-executed after a restored session proved invalid — is
// recorded from run, which the caller has already bound to its task.
func (s *Store) CompleteRun(project string, run Run, result RunResult) (Document, error) {
	if !safePathComponent(run.ID) {
		return Document{}, fmt.Errorf("invalid ui testing run id")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	state, err := s.load(project)
	if err != nil {
		return Document{}, err
	}
	position := -1
	for i := range state.Document.Runs {
		if state.Document.Runs[i].ID == run.ID {
			position = i
		}
	}
	if position < 0 {
		if run.TestID == "" {
			return Document{}, fmt.Errorf("ui testing run not found")
		}
		run.StartedAt = time.Now().UTC()
		state.Document.Runs = append([]Run{run}, state.Document.Runs...)
		position = 0
	}
	stored := &state.Document.Runs[position]
	stored.Status, stored.Error, stored.Steps, stored.CompletedAt = result.Status, result.Error, result.Steps, time.Now().UTC()
	testID := stored.TestID
	ready, err := s.writeRunAssets(project, run.ID, result)
	if err != nil {
		return Document{}, err
	}
	if result.GuideMD != "" {
		upsertGuide(&state.Document, Guide{ID: "guide:" + testID, TestID: testID, RunID: run.ID, Title: result.GuideTitle, Markdown: result.GuideMD,
			PDFReady: ready.pdf, HTMLReady: ready.html, Screenshots: result.Steps, UpdatedAt: time.Now().UTC()})
	}
	markTest(&state.Document, testID, testStatus(result.Status), run.ID)
	state.Document.UpdatedAt = time.Now().UTC()
	return state.Document, s.save(project, state)
}

// guideFormats records which guide formats a run stored.
type guideFormats struct{ pdf, html bool }

func (s *Store) writeRunAssets(project, runID string, result RunResult) (guideFormats, error) {
	ready := guideFormats{}
	if len(result.Screenshots) == 0 && result.PDFBase64 == "" && result.GuideMD == "" {
		return ready, nil
	}
	assetDir := filepath.Join(s.dir, "assets", projectKey(project), runID)
	if err := os.MkdirAll(assetDir, 0o700); err != nil {
		return ready, err
	}
	for _, shot := range result.Screenshots {
		if err := writeAsset(assetDir, shot.Name, shot.ContentBase64); err != nil {
			return ready, err
		}
	}
	if result.PDFBase64 != "" {
		if err := writeAsset(assetDir, "guide.pdf", result.PDFBase64); err != nil {
			return ready, err
		}
		ready.pdf = true
	}
	if result.GuideMD != "" {
		if err := os.WriteFile(filepath.Join(assetDir, "guide.md"), []byte(result.GuideMD), 0o600); err != nil {
			return ready, err
		}
	}
	if result.GuideDocument != nil {
		raw, err := json.Marshal(result.GuideDocument)
		if err == nil {
			err = os.WriteFile(filepath.Join(assetDir, GuideDocumentAsset), raw, 0o600)
		}
		if err != nil {
			return ready, err
		}
		ready.html = true
	}
	return ready, nil
}

// testStatus maps a run outcome to the catalog status. A test skipped because
// a prerequisite failed is blocked, not failed: it never ran.
func testStatus(runStatus string) string {
	switch runStatus {
	case "passed":
		return "passed"
	case "skipped":
		return "blocked"
	default:
		return "failed"
	}
}

func markTest(doc *Document, testID, status, runID string) {
	for i := range doc.Tests {
		if doc.Tests[i].ID == testID {
			var incoming, current time.Time
			incomingIndex, currentIndex := len(doc.Runs), len(doc.Runs)
			for index, run := range doc.Runs {
				if run.ID == runID {
					incoming, incomingIndex = run.StartedAt, index
				}
				if run.ID == doc.Tests[i].LastRunID {
					current, currentIndex = run.StartedAt, index
				}
			}
			// An older task can settle after a new run has already completed.
			// Keep its history, but never replace the newer catalog outcome.
			if current.After(incoming) || (current.Equal(incoming) && currentIndex < incomingIndex) {
				return
			}
			doc.Tests[i].Status, doc.Tests[i].LastRunID = status, runID
		}
	}
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
