package transcript

import (
	"sort"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/domain"
)

const MaxItems = 2000
const Owned = "_wharnex_transcript_owned"

func Normalize(chatID string, items []domain.WorkspaceChatItem) []domain.WorkspaceChatItem {
	result := make([]domain.WorkspaceChatItem, 0, len(items))
	for _, item := range items {
		if strings.TrimSpace(item.ID) == "" {
			continue
		}
		item.ChatID = chatID
		if item.CreatedAt.IsZero() {
			item.CreatedAt = time.Now().UTC()
		}
		result = append(result, item)
	}
	if len(result) > MaxItems {
		result = result[len(result)-MaxItems:]
	}
	return result
}

// Merge keeps backend-authored entries omitted by a stale renderer snapshot.
// Ordinary renderer entries retain the existing whole-list replacement rule.
func Merge(previous, incoming []domain.WorkspaceChatItem, appendOnly bool) []domain.WorkspaceChatItem {
	result := append([]domain.WorkspaceChatItem(nil), incoming...)
	for _, old := range previous {
		owned, _ := old.Payload[Owned].(bool)
		if !owned && !appendOnly {
			continue
		}
		matched := false
		for i, item := range result {
			key := RequestKey(old)
			if old.ID != item.ID && (key == "" || key != RequestKey(item)) {
				continue
			}
			if appendOnly {
				result[i].CreatedAt = old.CreatedAt
			}
			if owned {
				payload := make(map[string]any, len(item.Payload)+1)
				for key, value := range item.Payload {
					payload[key] = value
				}
				payload[Owned] = true
				if !appendOnly && old.ID == item.ID {
					// Audit events carry redacted/bounded text. A renderer which
					// received that notification cannot rewrite the original
					// durable input using its event projection.
					payload["text"] = old.Payload["text"]
				}
				if appendOnly {
					payload["createdAt"] = old.CreatedAt.Format(time.RFC3339Nano)
				}
				result[i].Payload = payload
			}
			matched = true
			break
		}
		if !matched {
			result = append(result, old)
		}
	}
	result = converge(result)
	sort.SliceStable(result, func(i, j int) bool { return result[i].CreatedAt.Before(result[j].CreatedAt) })
	if len(result) > MaxItems {
		result = result[len(result)-MaxItems:]
	}
	return result
}

func converge(items []domain.WorkspaceChatItem) []domain.WorkspaceChatItem {
	result := make([]domain.WorkspaceChatItem, 0, len(items))
	positions := make(map[string]int, len(items))
	for _, item := range items {
		key := "item:" + item.ID
		if request := RequestKey(item); request != "" {
			key = "request:" + request
		}
		position, exists := positions[key]
		if !exists {
			positions[key] = len(result)
			result = append(result, item)
			continue
		}
		previous := result[position]
		owned := previous.Payload[Owned] == true || item.Payload[Owned] == true
		if strings.HasPrefix(item.ID, "request:") && !strings.HasPrefix(previous.ID, "request:") {
			item = previous
		}
		if owned {
			payload := make(map[string]any, len(item.Payload)+1)
			for name, value := range item.Payload {
				payload[name] = value
			}
			payload[Owned] = true
			item.Payload = payload
		}
		result[position] = item
	}
	return result
}

func RequestKey(item domain.WorkspaceChatItem) string {
	if item.Payload["role"] != "user" {
		return ""
	}
	iteration, _ := item.Payload["iteration"].(map[string]any)
	if iteration["phase"] != "outbound" {
		return ""
	}
	return RequestID(item)
}

func RequestID(item domain.WorkspaceChatItem) string {
	iteration, _ := item.Payload["iteration"].(map[string]any)
	requestID, _ := iteration["requestId"].(string)
	return requestID
}
