package uitesting

import (
	"errors"
	"strings"
	"time"
)

// MaxEnvironmentNotes bounds the reference notes of one environment.
const MaxEnvironmentNotes = 4000

// SetNotes stores an environment's reference notes. Notes are sent to GPT,
// so they must never hold credentials; the UI says so where they are edited.
func (s *Store) SetNotes(project, envID, notes string) (Document, error) {
	notes = strings.TrimSpace(notes)
	if len(notes) > MaxEnvironmentNotes {
		return Document{}, errors.New("environment notes exceed 4000 characters")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	state, err := s.load(project)
	if err != nil {
		return Document{}, err
	}
	for i := range state.Document.Environments {
		if state.Document.Environments[i].ID == envID {
			state.Document.Environments[i].Notes = notes
			state.Document.UpdatedAt = time.Now().UTC()
			return state.Document, s.save(project, state)
		}
	}
	return Document{}, errors.New("ui testing environment not found")
}
