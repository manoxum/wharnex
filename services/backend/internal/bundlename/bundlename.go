// Package bundlename is the single source of truth for constructing and
// parsing the request/response ZIP filenames exchanged with the planner:
//
//	whx_bundle_<req|res>_<chat_id>_<request_id>[_<subrequest_id>].zip
//
// The chat_id segment is deliberately restricted to characters other than
// '_' (see ChatIDPattern) so the request_id/subrequest_id segments — which
// always start with "req_" — can be located unambiguously after it, without
// needing a delimiter reserved from the id formats themselves.
//
// A main request has no subrequest_id. A derived request (repair, conflict
// resolution, workflow round, evidence review — anything with a
// domain.RequestLineage pointing at a root request) carries the derived
// request's own id as the subrequest_id, with the root request's id in the
// request_id position.
package bundlename

import (
	"fmt"
	"regexp"
)

// Kind distinguishes a request bundle (sent to the planner) from a response
// bundle (received back).
type Kind string

const (
	KindRequest  Kind = "req"
	KindResponse Kind = "res"
)

const prefix = "whx_bundle_"

// idSegment matches the ids.New("req") shape: "req_" + a UTC compact
// timestamp + "_" + 16 lowercase hex characters.
const idSegment = `req_[0-9]{8}T[0-9]{6}_[0-9a-f]{16}`

// ChatIDPattern is the allowed shape of the chat_id segment: no '_', so the
// first '_' after it always starts the request_id's own "req_" prefix.
var ChatIDPattern = regexp.MustCompile(`^[A-Za-z0-9-]{1,128}$`)

var namePattern = regexp.MustCompile(`^whx_bundle_(req|res)_([A-Za-z0-9-]{1,128})_(` + idSegment + `)(?:_(` + idSegment + `))?\.zip$`)
var duplicateNamePattern = regexp.MustCompile(`^whx_bundle_(req|res)_([A-Za-z0-9-]{1,128})_(` + idSegment + `)(?:_(` + idSegment + `))? ?\([1-9][0-9]{0,3}\)\.zip$`)

// Name is a parsed bundle filename.
type Name struct {
	Kind         Kind
	ChatID       string
	RequestID    string
	SubrequestID string // empty for a main (root) request
}

// Build constructs the canonical filename for a bundle. subrequestID is
// empty for a main request; for a derived request, requestID is the root
// request's id and subrequestID is the derived request's own id.
func Build(kind Kind, chatID, requestID, subrequestID string) string {
	if subrequestID == "" || subrequestID == requestID {
		return fmt.Sprintf("%s%s_%s_%s.zip", prefix, kind, chatID, requestID)
	}
	return fmt.Sprintf("%s%s_%s_%s_%s.zip", prefix, kind, chatID, requestID, subrequestID)
}

// Parse decodes a canonical bundle filename. It reports ok=false for any
// name that does not match the scheme exactly.
func Parse(filename string) (Name, bool) {
	m := namePattern.FindStringSubmatch(filename)
	if m == nil {
		return Name{}, false
	}
	return Name{Kind: Kind(m[1]), ChatID: m[2], RequestID: m[3], SubrequestID: m[4]}, true
}

// ParseWithDuplicateSuffix accepts the browser duplicate-download suffix
// appended before .zip while preserving the canonical parsed identity.
func ParseWithDuplicateSuffix(filename string) (Name, bool) {
	m := duplicateNamePattern.FindStringSubmatch(filename)
	if m == nil {
		return Name{}, false
	}
	return Name{Kind: Kind(m[1]), ChatID: m[2], RequestID: m[3], SubrequestID: m[4]}, true
}

// RequestIDFromFilename returns the effective request id a bundle is
// addressed to: the subrequest id when present, otherwise the root request
// id. Returns "" when the filename does not match the scheme.
func RequestIDFromFilename(filename string) string {
	name, ok := Parse(filename)
	if !ok {
		return ""
	}
	if name.SubrequestID != "" {
		return name.SubrequestID
	}
	return name.RequestID
}
