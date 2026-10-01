package app

import (
	"fmt"
	"regexp"
	"strings"

	"kernl.local/harness/backend/internal/domain"
)

// chatIDPattern is deliberately stricter than the desktop's own cacheKey
// pattern (which allows '_'): '_' is the field separator in the
// whx_bundle_<req|res>_<chatid>_<request_id>[_<subrequest_id>].zip naming
// scheme, so a chat id containing one would make the name ambiguous to
// parse. Every real chat id is a crypto.randomUUID() (hex and hyphens only),
// so this never rejects an actual chat in practice.
var chatIDPattern = regexp.MustCompile(`^[A-Za-z0-9-]{1,128}$`)

// SetChatID records the frontend's chat identifier against a session so
// bundle filenames can be scoped to it. It is validated, not trusted: a
// value containing '_' would make whx_bundle_* names ambiguous to parse.
func (s *Service) SetChatID(sessionID, chatID string) (domain.Session, error) {
	chatID = strings.TrimSpace(chatID)
	if chatID == "" {
		return s.store.Get(sessionID)
	}
	if !chatIDPattern.MatchString(chatID) {
		return domain.Session{}, fmt.Errorf("invalid chat_id %q", chatID)
	}
	return s.store.Update(sessionID, func(item *domain.Session) error {
		if item.ChatID != "" && item.ChatID != chatID {
			return fmt.Errorf("session is already owned by chat_id %q", item.ChatID)
		}
		item.ChatID = chatID
		return nil
	})
}
