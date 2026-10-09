package uitesting

import (
	"strings"
	"time"
)

const maxDesignHistory = 30

// BeginDesign records an operator brief whose design task was just queued.
func (s *Store) BeginDesign(project string, request DesignRequest) (Document, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	state, err := s.load(project)
	if err != nil {
		return Document{}, err
	}
	now := time.Now().UTC()
	request.Status, request.CreatedAt, request.UpdatedAt = "designing", now, now
	designs := append([]DesignRequest{request}, state.Document.Designs...)
	if len(designs) > maxDesignHistory {
		designs = designs[:maxDesignHistory]
	}
	state.Document.Designs, state.Document.UpdatedAt = designs, now
	return state.Document, s.save(project, state)
}

// FailDesign marks a still-open design request as failed. A late failure for a
// request that already finished is ignored.
func (s *Store) FailDesign(project, taskID, detail string) (Document, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	state, err := s.load(project)
	if err != nil {
		return Document{}, err
	}
	index := findDesign(state.Document.Designs, taskID)
	if index < 0 || state.Document.Designs[index].Status != "designing" {
		return state.Document, nil
	}
	now := time.Now().UTC()
	state.Document.Designs[index].Status = "failed"
	state.Document.Designs[index].Error = strings.TrimSpace(detail)
	state.Document.Designs[index].UpdatedAt, state.Document.UpdatedAt = now, now
	return state.Document, s.save(project, state)
}

// DismissDesign removes a finished design request from the visible history.
func (s *Store) DismissDesign(project, taskID string) (Document, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	state, err := s.load(project)
	if err != nil {
		return Document{}, err
	}
	index := findDesign(state.Document.Designs, taskID)
	if index < 0 || state.Document.Designs[index].Status == "designing" {
		return state.Document, nil
	}
	state.Document.Designs = append(state.Document.Designs[:index], state.Document.Designs[index+1:]...)
	state.Document.UpdatedAt = time.Now().UTC()
	return state.Document, s.save(project, state)
}

func findDesign(designs []DesignRequest, taskID string) int {
	taskID = strings.TrimSpace(taskID)
	for i, design := range designs {
		if taskID != "" && design.TaskID == taskID {
			return i
		}
	}
	return -1
}
