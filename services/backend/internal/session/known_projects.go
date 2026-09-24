package session

import (
	"fmt"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// KnownProject is a project this Wharnex has worked on or that the Desktop has
// opened before. Being known is not write authority; it only makes project
// history durable and nameable across Desktop/browser restarts.
type KnownProject struct {
	ProjectPath string    `json:"project_path"`
	Name        string    `json:"name"`
	LastSeenAt  time.Time `json:"last_seen_at"`
	Open        bool      `json:"open"`
}

// RememberKnownProject persists the fact that Desktop opened projectPath even
// when no chat/session was created. Session-backed history is merged at read
// time, so existing installs automatically retain every project they already
// worked in while new plain-open events no longer disappear with localStorage.
func (s *Store) RememberKnownProject(projectPath string, seenAt time.Time) error {
	projectPath = filepath.Clean(strings.TrimSpace(projectPath))
	if projectPath == "." || !filepath.IsAbs(projectPath) {
		return fmt.Errorf("known project path must be absolute")
	}
	if seenAt.IsZero() {
		seenAt = time.Now().UTC()
	}
	entry := KnownProject{ProjectPath: projectPath, Name: filepath.Base(projectPath), LastSeenAt: seenAt}

	if s.db != nil {
		_, err := s.db.Exec(`INSERT INTO harness_known_projects (project_path, name, last_seen_at)
            VALUES ($1,$2,$3)
            ON CONFLICT (project_path) DO UPDATE SET
                name=EXCLUDED.name,
                last_seen_at=GREATEST(harness_known_projects.last_seen_at, EXCLUDED.last_seen_at)`,
			entry.ProjectPath, entry.Name, entry.LastSeenAt)
		return wrapPostgresError("remember known project", err)
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	history := s.knownProjectFallback()
	previous, existed := history[projectPath]
	if existed && previous.LastSeenAt.After(entry.LastSeenAt) {
		entry.LastSeenAt = previous.LastSeenAt
	}
	history[projectPath] = entry
	if err := s.persistLocked(); err != nil {
		if existed {
			history[projectPath] = previous
		} else {
			delete(history, projectPath)
		}
		return err
	}
	return nil
}

// ProjectHistory returns every durable project, most recently seen first.
// Explicit Desktop-open history is merged with session history so upgrading an
// existing installation immediately recovers older worked projects.
func (s *Store) ProjectHistory() ([]KnownProject, error) {
	s.mu.Lock()
	byPath := make(map[string]KnownProject, len(s.items)+len(s.knownProjects))
	for path, project := range s.knownProjectFallback() {
		byPath[path] = project
	}
	for _, item := range s.items {
		mergeSessionProject(byPath, item.ProjectPath, item.CreatedAt, item.LastHostAppliedAt, item.State)
	}
	s.mu.Unlock()

	if s.db != nil {
		rows, err := s.db.Query(`SELECT project_path, name, last_seen_at FROM harness_known_projects`)
		if err != nil {
			return sortedKnownProjects(byPath), wrapPostgresError("list known projects", err)
		}
		defer rows.Close()
		for rows.Next() {
			var project KnownProject
			if err := rows.Scan(&project.ProjectPath, &project.Name, &project.LastSeenAt); err != nil {
				return sortedKnownProjects(byPath), wrapPostgresError("scan known project", err)
			}
			mergeKnownProject(byPath, project)
		}
		if err := rows.Err(); err != nil {
			return sortedKnownProjects(byPath), wrapPostgresError("iterate known projects", err)
		}
	}

	return sortedKnownProjects(byPath), nil
}

func sortedKnownProjects(byPath map[string]KnownProject) []KnownProject {
	projects := make([]KnownProject, 0, len(byPath))
	for _, project := range byPath {
		projects = append(projects, project)
	}
	sort.Slice(projects, func(i, j int) bool {
		if projects[i].LastSeenAt.Equal(projects[j].LastSeenAt) {
			return projects[i].ProjectPath < projects[j].ProjectPath
		}
		return projects[i].LastSeenAt.After(projects[j].LastSeenAt)
	})
	return projects
}

// KnownProjects keeps the existing cross-project API shape. Database failures
// are intentionally fail-soft there because reference suggestions are optional;
// the dedicated project-history endpoint uses ProjectHistory and reports them.
func (s *Store) KnownProjects() []KnownProject {
	projects, _ := s.ProjectHistory()
	return projects
}

func (s *Store) knownProjectFallback() map[string]KnownProject {
	if s.knownProjects == nil {
		s.knownProjects = make(map[string]KnownProject)
	}
	return s.knownProjects
}

func mergeSessionProject(byPath map[string]KnownProject, projectPath string, createdAt, appliedAt time.Time, state string) {
	projectPath = strings.TrimSpace(projectPath)
	if projectPath == "" {
		return
	}
	seen := createdAt
	if appliedAt.After(seen) {
		seen = appliedAt
	}
	current, exists := byPath[projectPath]
	if !exists {
		current = KnownProject{ProjectPath: projectPath, Name: filepath.Base(projectPath)}
	}
	if seen.After(current.LastSeenAt) {
		current.LastSeenAt = seen
	}
	if sessionHoldsProject(state) {
		current.Open = true
	}
	byPath[projectPath] = current
}

func mergeKnownProject(byPath map[string]KnownProject, project KnownProject) {
	current, exists := byPath[project.ProjectPath]
	if !exists || project.LastSeenAt.After(current.LastSeenAt) {
		current.ProjectPath = project.ProjectPath
		current.Name = project.Name
		current.LastSeenAt = project.LastSeenAt
	}
	current.Open = current.Open || project.Open
	byPath[project.ProjectPath] = current
}

func sessionHoldsProject(state string) bool {
	switch strings.TrimSpace(state) {
	case "", "closed", "archived":
		return false
	default:
		return true
	}
}
