package browsermonitor

import (
	"net/url"
	"regexp"
	"sort"
	"strings"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/orchestrator"
	"kernl.local/harness/backend/internal/session"
)

var conversationID = regexp.MustCompile(`^[A-Za-z0-9-]{1,128}$`)

type Chat struct {
	Key         string `json:"key"`
	ProjectPath string `json:"project_path"`
	ChatID      string `json:"chat_id"`
	SessionID   string `json:"session_id,omitempty"`
	Title       string `json:"title"`
	URL         string `json:"url"`
	Kind        string `json:"kind"`
	Archived    bool   `json:"archived,omitempty"`
}

// ConversationURL accepts only the provider's concrete conversation address.
func ConversationURL(raw string) string {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Scheme != "https" || parsed.Host != "chatgpt.com" || parsed.User != nil {
		return ""
	}
	parts := strings.Split(parsed.Path, "/")
	id := ""
	if len(parts) == 3 && parts[1] == "c" {
		id = parts[2]
	} else if len(parts) == 5 && parts[1] == "g" && strings.HasPrefix(parts[2], "g-p-") && parts[3] == "c" {
		id = parts[4]
	}
	if !conversationID.MatchString(id) {
		return ""
	}
	return "https://chatgpt.com/c/" + id
}

func URLForID(id string) string {
	if !conversationID.MatchString(id) {
		return ""
	}
	return "https://chatgpt.com/c/" + id
}

func Build(workspace []domain.WorkspaceChat, tasks []orchestrator.Task, planning []session.ChatAgentTask, owners map[string]string) []Chat {
	chats := make([]Chat, 0, len(workspace)+len(tasks)+len(planning))
	for _, item := range workspace {
		address := ConversationURL(item.ChatGPTURL)
		if address == "" {
			address = URLForID(item.ConversationID)
		}
		if address == "" {
			continue
		}
		title := strings.TrimSpace(item.Title)
		if title == "" {
			title = "Chat " + item.ID
		}
		chats = append(chats, Chat{Key: "workspace:" + item.ID, ProjectPath: item.ProjectPath, ChatID: item.ID, SessionID: item.SessionID, Title: title, URL: address, Kind: "workspace", Archived: item.Archived()})
	}
	for _, item := range tasks {
		address := ConversationURL(item.ConversationURL)
		if address == "" {
			address = URLForID(item.ConversationID)
		}
		if address == "" {
			continue
		}
		title := strings.TrimSpace(item.Title)
		if title == "" {
			title = "Task " + item.ID
		}
		chats = append(chats, Chat{Key: "task:" + item.ID, ProjectPath: item.ProjectPath, ChatID: item.ID, SessionID: owners[item.ProjectPath], Title: title, URL: address, Kind: "task", Archived: item.Status == orchestrator.TaskArchived})
	}
	seen := make(map[string]bool)
	for _, item := range planning {
		key := item.ProjectID + ":" + item.ChatID
		if item.Type != "ORCHESTRATOR_PLAN" || seen[key] {
			continue
		}
		address := URLForID(item.ConversationID)
		if address == "" {
			continue
		}
		seen[key] = true
		title := strings.TrimSpace(item.Title)
		if title == "" {
			title = "Planeamento " + item.ChatID
		}
		chats = append(chats, Chat{Key: "planning:" + item.ChatID, ProjectPath: item.ProjectID, ChatID: item.ChatID, SessionID: item.SessionID, Title: title, URL: address, Kind: "planning"})
	}
	sort.Slice(chats, func(i, j int) bool {
		return chats[i].ProjectPath < chats[j].ProjectPath || chats[i].ProjectPath == chats[j].ProjectPath && chats[i].Title < chats[j].Title
	})
	return chats
}
