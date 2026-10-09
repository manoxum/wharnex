package app

import (
	"context"
	"errors"
	"sort"
	"strings"

	"kernl.local/harness/backend/internal/app/browsermonitor"
	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/orchestrator"
	"kernl.local/harness/backend/internal/session"
)

type ManagedArtifact struct {
	SessionID   string                `json:"session_id"`
	ProjectPath string                `json:"project_path"`
	ChatID      string                `json:"chat_id,omitempty"`
	Artifact    domain.ArtifactRecord `json:"artifact"`
}

// BrowserMonitorChats is a global, read-only catalog for the local operator's
// process-global browser monitor. It never creates provider requests.
func (s *Service) BrowserMonitorChats(ctx context.Context) ([]browsermonitor.Chat, error) {
	projects, err := s.store.ProjectHistory()
	if err != nil {
		return nil, err
	}
	workspace := make([]domain.WorkspaceChat, 0)
	tasks := make([]orchestrator.Task, 0)
	planning := make([]session.ChatAgentTask, 0)
	owners := make(map[string]string)
	for _, item := range s.store.List() {
		if owners[item.ProjectPath] == "" {
			owners[item.ProjectPath] = item.ID
		}
	}
	for _, project := range projects {
		chats, listErr := s.store.ListWorkspaceChats(project.ProjectPath)
		if listErr != nil {
			return nil, listErr
		}
		workspace = append(workspace, chats...)
		projectTasks, listErr := s.orchestrator.ListTasks(ctx, project.ProjectPath)
		if listErr != nil {
			return nil, listErr
		}
		tasks = append(tasks, projectTasks...)
		for _, scope := range []string{session.UnifiedTaskScopeActive, session.UnifiedTaskScopeHistory} {
			cursor := ""
			for {
				page, listErr := s.store.ListUnifiedTaskPage(session.UnifiedTaskPageFilter{
					ProjectID: project.ProjectPath, Scope: scope, Limit: 100, Cursor: cursor,
				})
				if listErr != nil {
					return nil, listErr
				}
				for _, task := range page.Tasks {
					if task.Type == "ORCHESTRATOR_PLAN" {
						planning = append(planning, task)
					}
				}
				if !page.HasMore {
					break
				}
				if page.NextCursor == "" || page.NextCursor == cursor {
					return nil, errors.New("browser monitor task catalog has an invalid cursor")
				}
				cursor = page.NextCursor
			}
		}
	}
	return browsermonitor.Build(workspace, tasks, planning, owners), nil
}

// ListManagedArtifacts exposes the artifact metadata Wharnex already owns.
// Object keys and MinIO credentials intentionally remain server-only.
func (s *Service) ListManagedArtifacts(query string, bundlesOnly bool) []ManagedArtifact {
	return s.ListManagedArtifactsByKind(query, bundlesOnly, "")
}

func (s *Service) ListManagedArtifactsByKind(query string, bundlesOnly bool, kind string) []ManagedArtifact {
	query = strings.ToLower(strings.TrimSpace(query))
	kind = strings.ToLower(strings.TrimSpace(kind))
	items := make([]ManagedArtifact, 0)
	for _, session := range s.store.List() {
		for _, artifact := range session.Artifacts {
			if kind != "" && artifact.Kind != kind {
				continue
			}
			if bundlesOnly && !artifact.Bundle {
				continue
			}
			if query != "" && !managedArtifactMatches(query, session, artifact) {
				continue
			}
			items = append(items, ManagedArtifact{
				SessionID: session.ID, ProjectPath: session.ProjectPath,
				ChatID: session.ChatID, Artifact: artifact,
			})
		}
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Artifact.CreatedAt.After(items[j].Artifact.CreatedAt) })
	return items
}

func managedArtifactMatches(query string, session domain.Session, artifact domain.ArtifactRecord) bool {
	values := []string{session.ID, session.ProjectPath, session.ChatID, artifact.ID, artifact.Name, artifact.RequestID, artifact.Direction, artifact.Kind, artifact.SHA256}
	for _, value := range values {
		if strings.Contains(strings.ToLower(value), query) {
			return true
		}
	}
	return false
}

func (s *Service) DeleteManagedArtifact(ctx context.Context, sessionID, artifactID string) error {
	record, err := s.artifactRecord(sessionID, artifactID)
	if err != nil {
		return err
	}
	if s.artifactStore == nil {
		return errors.New("artifact storage is unavailable")
	}
	if record.ObjectKey == "" {
		return errors.New("artifact object location is unavailable")
	}
	if err := s.artifactStore.Delete(ctx, record.ObjectKey); err != nil {
		return err
	}
	_, err = s.store.Update(sessionID, func(item *domain.Session) error {
		kept := item.Artifacts[:0]
		for _, candidate := range item.Artifacts {
			if candidate.ID != artifactID {
				kept = append(kept, candidate)
			}
		}
		item.Artifacts = kept
		return nil
	})
	if err == nil {
		s.bus.Publish(sessionID, "artifact.deleted", map[string]any{"artifact_id": artifactID, "name": record.Name})
	}
	return err
}
