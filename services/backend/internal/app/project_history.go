package app

import (
	"time"

	"kernl.local/harness/backend/internal/domain"
)

// RememberProjectOpened makes a Desktop-open event durable independently from
// chats, sessions and storage usage. A project does not need to have executed
// anything to remain discoverable by Wharnex Remote later.
func (s *Service) RememberProjectOpened(projectPath string) error {
	project, err := normalizeProjectPath(projectPath)
	if err != nil {
		return err
	}
	return s.store.RememberKnownProject(project, time.Now().UTC())
}

// ProjectHistory is the durable Desktop project catalog used by remote clients.
// It intentionally does not require a session because history must include
// projects that were merely opened and then closed.
func (s *Service) ProjectHistory() ([]domain.KnownProjectRef, error) {
	known, err := s.store.ProjectHistory()
	if err != nil {
		return nil, err
	}
	projects := make([]domain.KnownProjectRef, 0, len(known))
	for _, project := range known {
		projects = append(projects, domain.KnownProjectRef{
			Name:        project.Name,
			ProjectPath: project.ProjectPath,
			Open:        project.Open,
		})
	}
	return projects, nil
}
