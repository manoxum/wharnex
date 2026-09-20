package app

import (
	"encoding/json"
	"regexp"
	"sort"
	"strings"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/session"
)

// A chat's conversation binding is local metadata with no remote mirror: once
// the stored URL is gone, nothing in ChatGPT tells Wharnex which conversation
// the chat belonged to, and the chat silently falls back to the ChatGPT home
// surface as if it had never been bound.
//
// SaveWorkspaceChat no longer clears a binding by omission, which is what let
// an ordinary title or transcript save destroy one. This file is the other
// half: recovering the chats already broken, and giving a broken chat a way
// back that does not depend on the operator remembering a URL.
//
// Recovery proposes candidates from evidence Wharnex already holds and can
// establish only a missing first binding. Binding a chat to the wrong
// conversation would send the next request into somebody else's thread, so
// the operator confirms.

// BindingEvidence names where a candidate conversation came from, so the
// operator can judge it rather than trust a bare URL.
const (
	// BindingEvidenceAgentQueue is the strongest: Wharnex's own durable browser
	// queue drove that conversation for this exact chat.
	BindingEvidenceAgentQueue = "agent_queue"
	// BindingEvidenceTranscript comes from the chat's own recorded transcript.
	BindingEvidenceTranscript = "transcript"
	// BindingEvidenceSessionEvents comes from the session's event history.
	BindingEvidenceSessionEvents = "session_events"
)

// WorkspaceChatBindingCandidate is one conversation a broken chat may belong to.
type WorkspaceChatBindingCandidate struct {
	ChatGPTURL     string `json:"chatgpt_url"`
	ConversationID string `json:"conversation_id"`
	Evidence       string `json:"evidence"`
	// BoundToChatID names the chat that already owns this conversation, when
	// one does. Such a candidate is reported rather than hidden — seeing that
	// the conversation belongs elsewhere is itself the answer — but it must
	// never be presented as safe to take.
	BoundToChatID string `json:"bound_to_chat_id,omitempty"`
	Conflict      bool   `json:"conflict"`
}

// WorkspaceChatBindingRecovery is what the recovery surface shows for one chat.
type WorkspaceChatBindingRecovery struct {
	ChatID     string                          `json:"chat_id"`
	Bound      bool                            `json:"bound"`
	ChatGPTURL string                          `json:"chatgpt_url,omitempty"`
	Candidates []WorkspaceChatBindingCandidate `json:"candidates"`
}

var conversationURLPattern = regexp.MustCompile(`https://chatgpt\.com/c/([A-Za-z0-9][A-Za-z0-9_-]{2,})`)

// RecoverWorkspaceChatBinding gathers the conversations a chat may belong to.
// It reads only Wharnex's own durable records and proposes; it never writes.
func (s *Service) RecoverWorkspaceChatBinding(chatID string) (WorkspaceChatBindingRecovery, error) {
	id := strings.TrimSpace(chatID)
	if id == "" {
		return WorkspaceChatBindingRecovery{}, ErrInvalidWorkspaceChat
	}
	chat, err := s.store.GetWorkspaceChat(id)
	if err != nil {
		return WorkspaceChatBindingRecovery{}, err
	}
	recovery := WorkspaceChatBindingRecovery{
		ChatID:     id,
		ChatGPTURL: normalizeChatGPTConversationURL(chat.ChatGPTURL),
		Candidates: []WorkspaceChatBindingCandidate{},
	}
	recovery.Bound = recovery.ChatGPTURL != ""

	owners := s.conversationOwners(chat.ProjectPath)
	seen := make(map[string]bool)
	for _, found := range s.bindingEvidence(chat) {
		if found.url == "" || seen[found.url] {
			continue
		}
		seen[found.url] = true
		candidate := WorkspaceChatBindingCandidate{
			ChatGPTURL:     found.url,
			ConversationID: chatGPTConversationIDFromURL(found.url),
			Evidence:       found.evidence,
		}
		if owner := owners[candidate.ConversationID]; owner != "" && owner != id {
			candidate.BoundToChatID = owner
			candidate.Conflict = true
		}
		recovery.Candidates = append(recovery.Candidates, candidate)
	}
	sort.SliceStable(recovery.Candidates, func(i, j int) bool {
		return bindingEvidenceRank(recovery.Candidates[i]) < bindingEvidenceRank(recovery.Candidates[j])
	})
	return recovery, nil
}

// bindingEvidenceRank orders candidates by how directly the evidence ties the
// conversation to this chat. A conversation already owned by another chat sinks
// to the bottom whatever produced it.
func bindingEvidenceRank(candidate WorkspaceChatBindingCandidate) int {
	if candidate.Conflict {
		return 9
	}
	switch candidate.Evidence {
	case BindingEvidenceAgentQueue:
		return 0
	case BindingEvidenceTranscript:
		return 1
	default:
		return 2
	}
}

type bindingCandidateSource struct {
	url      string
	evidence string
}

// bindingEvidence collects candidate conversations in authority order. Every
// source is best effort: a store that cannot answer contributes nothing rather
// than failing the recovery, because a partial list is still useful and an
// error here would leave the operator with no way back at all.
func (s *Service) bindingEvidence(chat domain.WorkspaceChat) []bindingCandidateSource {
	found := make([]bindingCandidateSource, 0, 4)
	if tasks, err := s.store.ListChatAgentTasks(session.ChatAgentTaskFilter{ChatID: chat.ID, Limit: 200}); err == nil {
		for _, task := range tasks {
			if url := conversationURLFromID(task.ConversationID); url != "" {
				found = append(found, bindingCandidateSource{url: url, evidence: BindingEvidenceAgentQueue})
			}
		}
	}
	if items, err := s.store.ListWorkspaceChatItems(chat.ID); err == nil {
		for _, item := range items {
			found = append(found, scanBindingURLs(item.Payload, BindingEvidenceTranscript)...)
		}
	}
	if sessionID := strings.TrimSpace(chat.SessionID); sessionID != "" {
		if events, err := s.store.EventHistory(sessionID); err == nil {
			for _, event := range events {
				found = append(found, scanBindingURLs(event.Data, BindingEvidenceSessionEvents)...)
			}
		}
	}
	return found
}

// scanBindingURLs pulls conversation URLs out of an opaque renderer payload.
// The payload shape is renderer-owned and deliberately not modelled here, so
// the text is scanned rather than walked field by field.
func scanBindingURLs(payload map[string]any, evidence string) []bindingCandidateSource {
	if len(payload) == 0 {
		return nil
	}
	text := payloadText(payload)
	if text == "" {
		return nil
	}
	matches := conversationURLPattern.FindAllStringSubmatch(text, 8)
	found := make([]bindingCandidateSource, 0, len(matches))
	for _, match := range matches {
		if url := normalizeChatGPTConversationURL(match[0]); url != "" {
			found = append(found, bindingCandidateSource{url: url, evidence: evidence})
		}
	}
	return found
}

// conversationOwners maps each conversation already bound in this project to
// the chat that owns it, so a candidate that would steal another chat's thread
// is marked instead of offered.
func (s *Service) conversationOwners(projectPath string) map[string]string {
	owners := make(map[string]string)
	chats, err := s.store.ListWorkspaceChats(projectPath)
	if err != nil {
		return owners
	}
	for _, chat := range chats {
		if id := strings.TrimSpace(chat.ConversationID); id != "" {
			owners[id] = chat.ID
		}
	}
	return owners
}

// payloadText renders an opaque payload as JSON text for scanning. A payload
// that cannot be encoded contributes nothing rather than failing recovery.
func payloadText(payload map[string]any) string {
	encoded, err := json.Marshal(payload)
	if err != nil {
		return ""
	}
	return string(encoded)
}

func conversationURLFromID(conversationID string) string {
	id := strings.TrimSpace(conversationID)
	if id == "" {
		return ""
	}
	return normalizeChatGPTConversationURL("https://chatgpt.com/c/" + id)
}
