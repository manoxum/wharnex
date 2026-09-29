package app

import (
	"strings"
)

// interactiveConnectionSection describes only handles held by the engine.
// Their credentials remain in the backend; project context and a database
// mentioned in a user message never create a connection implicitly.
func (s *Service) interactiveConnectionSection() string {
	s.interactiveDBMu.RLock()
	_, internalRegistered := s.interactiveDB["wharnex-internal"]
	s.interactiveDBMu.RUnlock()

	var out strings.Builder
	out.WriteString("SQL CONNECTION HANDLES (engine registered; no credentials):\n")
	if internalRegistered {
		out.WriteString("- wharnex-internal: Wharnex runtime database only; it is not the linked project's database.\n")
	}
	out.WriteString("PROJECT SQL CONNECTION HANDLES: none registered for the linked project. Do not invent a connection_id.\n")
	return out.String()
}
