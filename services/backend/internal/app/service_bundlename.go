package app

import (
	"strings"

	"kernl.local/harness/backend/internal/bundlename"
	"kernl.local/harness/backend/internal/domain"
)

// expectedResponseBundleFilename computes the canonical whx_bundle_res_* name
// the manual/ZIP transport prompt tells the planner to return for requestID.
// A request with a recorded lineage back to a different root (repair,
// conflict resolution, workflow round, evidence review) names the root
// request in the request_id position and requestID itself as the
// subrequest_id; a main request carries no subrequest_id.
func expectedResponseBundleFilename(item domain.Session, requestID string) string {
	chatID := sessionChatID(item)
	rootID, subID := requestID, ""
	if lineage, ok := item.RequestLineages[requestID]; ok && lineage.RootRequestID != "" {
		rootID, subID = lineage.RootRequestID, requestID
	}
	return bundlename.Build(bundlename.KindResponse, chatID, rootID, subID)
}

// expectedResponseBundleFilenameForDerivedRequest computes the same name as
// expectedResponseBundleFilename, for a newRequestID freshly minted by
// recordRequestLineage(item, newRequestID, parentRequestID, ...) that has not
// been recorded yet (repair, conflict resolution, workflow continuation: the
// lineage is only written once the planner call succeeds). newRequestID is
// always the subrequest_id here — a derived request is never the root itself.
func expectedResponseBundleFilenameForDerivedRequest(item domain.Session, newRequestID, parentRequestID string) string {
	rootID := parentRequestID
	if lineage, ok := item.RequestLineages[parentRequestID]; ok && lineage.RootRequestID != "" {
		rootID = lineage.RootRequestID
	}
	return bundlename.Build(bundlename.KindResponse, sessionChatID(item), rootID, newRequestID)
}

// requestBundleFilename computes the canonical whx_bundle_req_* name for the
// request-side ZIP sent to the planner for requestID (the local/remote
// manual-transport archive). Same lineage rule as the response name.
func requestBundleFilename(item domain.Session, requestID string) string {
	rootID, subID := requestID, ""
	if lineage, ok := item.RequestLineages[requestID]; ok && lineage.RootRequestID != "" {
		rootID, subID = lineage.RootRequestID, requestID
	}
	return bundlename.Build(bundlename.KindRequest, sessionChatID(item), rootID, subID)
}

func sessionChatID(item domain.Session) string {
	chatID := strings.TrimSpace(item.ChatID)
	if chatID == "" || !bundlename.ChatIDPattern.MatchString(chatID) {
		return "system"
	}
	return chatID
}
