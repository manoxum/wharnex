package session

import (
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// KnownProject is a project this Wharnex has worked on before.
//
// It exists because "which projects can I point at?" and "which projects are
// open right now?" are different questions, and only the second one used to
// have an answer. An operator who spent last week in a repository still thinks
// of it by name today, and requiring them to open it first only to write one
// sentence about it is asking them to restage their workspace to ask a
// question.
//
// Being known is not authority. It makes a name resolvable and a context
// transportable; what a request may *change* is decided separately, and still
// needs a live session carrying the modes the operator chose for that project.
type KnownProject struct {
	ProjectPath string    `json:"project_path"`
	Name        string    `json:"name"`
	LastSeenAt  time.Time `json:"last_seen_at"`
	// Open reports whether some session currently holds this project, which is
	// what separates a project that can merely be read from one that can also
	// receive a change.
	Open bool `json:"open"`
}

// KnownProjects lists every project with a session record, most recent first.
//
// Sessions are the durable trace of having worked somewhere: they survive
// closing a workspace, and they are server-side, so this answer does not depend
// on which machine or browser profile the operator is using today.
func (s *Store) KnownProjects() []KnownProject {
	s.mu.RLock()
	defer s.mu.RUnlock()
	byPath := make(map[string]KnownProject)
	for _, item := range s.items {
		path := strings.TrimSpace(item.ProjectPath)
		if path == "" {
			continue
		}
		seen := item.CreatedAt
		if item.LastHostAppliedAt.After(seen) {
			seen = item.LastHostAppliedAt
		}
		current, exists := byPath[path]
		if !exists {
			current = KnownProject{ProjectPath: path, Name: filepath.Base(path)}
		}
		if seen.After(current.LastSeenAt) {
			current.LastSeenAt = seen
		}
		// A session in a terminal local state is history; one that is still
		// usable means the project is open somewhere and can receive work.
		if sessionHoldsProject(item.State) {
			current.Open = true
		}
		byPath[path] = current
	}
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

func sessionHoldsProject(state string) bool {
	switch strings.TrimSpace(state) {
	case "", "closed", "archived":
		return false
	default:
		return true
	}
}
