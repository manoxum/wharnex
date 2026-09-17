package app

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/session"
	"kernl.local/harness/backend/internal/todoclassification"
)

func (s *Service) reconcileProjectTodoClassification(item domain.ProjectTodo) domain.ProjectTodo {
	if item.ClassificationStatus != domain.ProjectTodoClassificationQueued || item.ClassificationTaskID == "" {
		return item
	}
	task, err := s.store.GetChatAgentTask(item.ClassificationTaskID)
	if err != nil {
		return item
	}
	if task.Status == session.ChatAgentTaskDone {
		var delivered todoClassificationWorkerResult
		if json.Unmarshal(task.Payload, &delivered) == nil && delivered.Protocol == todoclassification.ResultProtocolV1 && delivered.TaskID == item.ClassificationTaskID {
			bundle, decodeErr := base64.StdEncoding.DecodeString(delivered.BundleBase64)
			manifest, _, requestErr := todoclassification.BuildRequest(item.ClassificationTaskID, item.ID, todoClassificationSource(item), todoclassification.RequestMetadata{})
			if decodeErr == nil && requestErr == nil {
				if parsed, parseErr := todoclassification.ParseResult(delivered.Filename, bundle, manifest); parseErr == nil {
					item.Kind, item.Urgency = parsed.Kind, parsed.Urgency
					item.Description, item.PrePlan = parsed.Description, append([]string(nil), parsed.PrePlan...)
					item.ClassificationStatus, item.ClassificationError = domain.ProjectTodoClassificationClassified, ""
					if saved, saveErr := s.store.SaveProjectTodo(item); saveErr == nil {
						return saved
					}
				} else {
					item.ClassificationError = parseErr.Error()
				}
			}
		}
		item.ClassificationStatus = domain.ProjectTodoClassificationFailed
		if item.ClassificationError == "" {
			item.ClassificationError = "classification worker returned an invalid response bundle"
		}
		if saved, saveErr := s.store.SaveProjectTodo(item); saveErr == nil {
			return saved
		}
	}
	if task.Status == session.ChatAgentTaskFailed || task.Status == session.ChatAgentTaskAttention || task.Status == session.ChatAgentTaskCancelled {
		item.ClassificationStatus = domain.ProjectTodoClassificationFailed
		item.ClassificationError = strings.TrimSpace(task.LastError)
		if item.ClassificationError == "" {
			item.ClassificationError = "classification worker did not complete"
		}
		if saved, saveErr := s.store.SaveProjectTodo(item); saveErr == nil {
			return saved
		}
	}
	return item
}

func validateProjectTodoLinks(input ProjectTodoCreateInput) error {
	if len(input.Attachments) > 10 || len(input.ProjectFiles) > 128 {
		return fmt.Errorf("TODO attachment or project-file limit exceeded")
	}
	if len(input.Attachments) > 0 && strings.TrimSpace(input.AttachmentCacheKey) == "" {
		return fmt.Errorf("attachment_cache_key is required when TODO attachments are present")
	}
	var total int64
	for _, attachment := range input.Attachments {
		if attachment.Size <= 0 || attachment.Size > 25<<20 || strings.TrimSpace(attachment.Name) == "" || strings.TrimSpace(attachment.StorageRef) == "" {
			return fmt.Errorf("TODO attachment metadata is invalid")
		}
		if input.AttachmentCacheKey != "" && !strings.HasPrefix(attachment.StorageRef, input.AttachmentCacheKey+"/") {
			return fmt.Errorf("TODO attachment does not belong to its cache key")
		}
		total += attachment.Size
	}
	if total > 100<<20 {
		return fmt.Errorf("TODO attachments exceed the 100 MiB total limit")
	}
	for _, file := range input.ProjectFiles {
		if strings.TrimSpace(file) == "" || filepath.IsAbs(file) || strings.HasPrefix(filepath.Clean(file), "..") {
			return fmt.Errorf("TODO project file path is invalid")
		}
	}
	return nil
}

func todoClassificationSource(item domain.ProjectTodo) string {
	var out strings.Builder
	out.WriteString("# TODO\n\n")
	out.WriteString(item.Body)
	if len(item.ProjectFiles) > 0 {
		out.WriteString("\n\n## Linked project files\n")
		for _, file := range item.ProjectFiles {
			out.WriteString("- " + file + "\n")
		}
	}
	if len(item.Attachments) > 0 {
		out.WriteString("\n## Linked attachments\n")
		for _, attachment := range item.Attachments {
			out.WriteString(fmt.Sprintf("- %s (%s, %d bytes)\n", attachment.Name, attachment.MIME, attachment.Size))
		}
	}
	return out.String()
}

func newProjectTodoID() string {
	var raw [10]byte
	if _, err := rand.Read(raw[:]); err == nil {
		return "todo_" + hex.EncodeToString(raw[:])
	}
	return fmt.Sprintf("todo_%d", time.Now().UTC().UnixNano())
}
