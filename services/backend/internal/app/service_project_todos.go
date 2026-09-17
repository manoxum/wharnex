package app

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/session"
	"kernl.local/harness/backend/internal/todoclassification"
)

type ProjectTodoCreateInput struct {
	Body               string                         `json:"body"`
	AttachmentCacheKey string                         `json:"attachment_cache_key"`
	Attachments        []domain.ProjectTodoAttachment `json:"attachments"`
	ProjectFiles       []string                       `json:"project_files"`
}

type ProjectTodoPatchInput struct {
	Status string `json:"status"`
}

type todoClassificationWorkerPayload struct {
	Protocol        string `json:"protocol"`
	Task            string `json:"task"`
	TaskID          string `json:"task_id"`
	TodoID          string `json:"todo_id"`
	RequestFilename string `json:"request_filename"`
	ResultFilename  string `json:"result_filename"`
	Bootstrap       string `json:"bootstrap"`
	ArchiveBase64   string `json:"archive_base64"`
	ReasoningEffort string `json:"reasoning_effort"`
}

type todoClassificationWorkerResult struct {
	Protocol     string `json:"protocol"`
	TaskID       string `json:"task_id"`
	Filename     string `json:"filename"`
	BundleBase64 string `json:"bundle_base64"`
}

func (s *Service) ListProjectTodos(sessionID string) ([]domain.ProjectTodo, error) {
	current, err := s.store.Get(sessionID)
	if err != nil {
		return nil, err
	}
	items, err := s.store.ListProjectTodos(current.ProjectPath)
	if err != nil {
		return nil, err
	}
	for index := range items {
		items[index] = s.reconcileProjectTodoClassification(items[index])
	}
	return items, nil
}

func (s *Service) CreateProjectTodo(sessionID string, input ProjectTodoCreateInput) (domain.ProjectTodo, error) {
	current, err := s.store.Get(sessionID)
	if err != nil {
		return domain.ProjectTodo{}, err
	}
	input.Body = strings.TrimSpace(input.Body)
	if len(input.Body) == 0 || len(input.Body) > 20_000 {
		return domain.ProjectTodo{}, fmt.Errorf("TODO body must be between 1 and 20000 characters")
	}
	if err := validateProjectTodoLinks(input); err != nil {
		return domain.ProjectTodo{}, err
	}
	item := domain.ProjectTodo{
		ID: newProjectTodoID(), ProjectPath: current.ProjectPath, Body: input.Body,
		Status: domain.ProjectTodoOpen, ClassificationStatus: domain.ProjectTodoClassificationQueued,
		AttachmentCacheKey: input.AttachmentCacheKey, Attachments: append([]domain.ProjectTodoAttachment(nil), input.Attachments...),
		ProjectFiles: append([]string(nil), input.ProjectFiles...),
	}
	item, err = s.store.SaveProjectTodo(item)
	if err != nil {
		return domain.ProjectTodo{}, err
	}
	return s.enqueueProjectTodoClassification(current, item)
}

func (s *Service) UpdateProjectTodo(sessionID, todoID string, input ProjectTodoPatchInput) (domain.ProjectTodo, error) {
	current, err := s.store.Get(sessionID)
	if err != nil {
		return domain.ProjectTodo{}, err
	}
	item, err := s.store.GetProjectTodo(todoID)
	if err != nil {
		return domain.ProjectTodo{}, err
	}
	if item.ProjectPath != current.ProjectPath {
		return domain.ProjectTodo{}, fmt.Errorf("project TODO does not belong to this project")
	}
	status := strings.ToLower(strings.TrimSpace(input.Status))
	if status != domain.ProjectTodoOpen && status != domain.ProjectTodoDone {
		return domain.ProjectTodo{}, fmt.Errorf("unsupported TODO status %q", input.Status)
	}
	item.Status = status
	return s.store.SaveProjectTodo(item)
}

func (s *Service) ReclassifyProjectTodo(sessionID, todoID string) (domain.ProjectTodo, error) {
	current, err := s.store.Get(sessionID)
	if err != nil {
		return domain.ProjectTodo{}, err
	}
	item, err := s.store.GetProjectTodo(todoID)
	if err != nil {
		return domain.ProjectTodo{}, err
	}
	if item.ProjectPath != current.ProjectPath {
		return domain.ProjectTodo{}, fmt.Errorf("project TODO does not belong to this project")
	}
	item.ClassificationStatus = domain.ProjectTodoClassificationQueued
	item.ClassificationError = ""
	item.ClassificationTaskID = ""
	item.Kind, item.Urgency, item.Description, item.PrePlan = "", "", "", nil
	item, err = s.store.SaveProjectTodo(item)
	if err != nil {
		return domain.ProjectTodo{}, err
	}
	return s.enqueueProjectTodoClassification(current, item)
}

func (s *Service) enqueueProjectTodoClassification(current domain.Session, item domain.ProjectTodo) (domain.ProjectTodo, error) {
	taskID := session.NewChatAgentTaskID()
	chatHash := current.Context.WorkspaceSHA256
	if chatHash == "" {
		chatHash = current.Context.Manifest.SHA256
	}
	manifest, archive, err := todoclassification.BuildRequest(taskID, item.ID, todoClassificationSource(item), todoclassification.RequestMetadata{
		ChatTitle: "TODO classification", ChatID: current.ChatID, ChatHash: chatHash, RequestedAt: time.Now().UTC().Format(time.RFC3339Nano),
	})
	if err != nil {
		item.ClassificationStatus, item.ClassificationError = domain.ProjectTodoClassificationFailed, err.Error()
		return s.store.SaveProjectTodo(item)
	}
	payload, err := json.Marshal(todoClassificationWorkerPayload{
		Protocol: todoclassification.RequestProtocolV1, Task: todoclassification.TaskClassifyTodo,
		TaskID: taskID, TodoID: item.ID, RequestFilename: manifest.RequestFilename, ResultFilename: manifest.ResultFilename,
		Bootstrap: todoclassification.RequestBootstrap(manifest), ArchiveBase64: base64.StdEncoding.EncodeToString(archive),
		ReasoningEffort: string(domain.ReasoningEffortMedium),
	})
	if err != nil {
		return domain.ProjectTodo{}, err
	}
	_, err = s.store.EnqueueChatAgentTask(session.ChatAgentTask{
		Type: "TODO_CLASSIFY", TaskID: taskID, ProjectID: current.ProjectPath, ChatID: item.ID, SessionID: current.ID,
		RequestID: item.ID, RootRequestID: item.ID, DedupeKey: "todo-classify:" + item.ID,
		Payload: payload, MaxAttempts: 4,
	})
	if err != nil {
		item.ClassificationStatus, item.ClassificationError = domain.ProjectTodoClassificationFailed, err.Error()
		return s.store.SaveProjectTodo(item)
	}
	item.ClassificationTaskID = taskID
	item.ClassificationStatus = domain.ProjectTodoClassificationQueued
	item.ClassificationError = ""
	return s.store.SaveProjectTodo(item)
}
