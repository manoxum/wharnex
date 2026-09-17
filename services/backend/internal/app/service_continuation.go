package app

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/planner"
)

const (
	conflictCapsuleArtifactPath   = "conflict/capsule.json"
	mainRequestArtifactPath       = "requests/main.md"
	adjustmentRequestArtifactPath = "requests/adjustment.md"
	maxRequestSupportArtifacts    = 24
)

func marshalIndented(value any) ([]byte, error) { return json.MarshalIndent(value, "", "  ") }

// prepareContinuation is the single preparation step every derived request in a
// Main Request must run, immediately after its context refresh and before its
// prompt is built.
//
// It does two things that were previously done only for the Main Request, and
// whose absence is what made multi-round corrections diverge from the local
// project:
//
//  1. It anchors this request's own base tree. Until now only the Main Request
//     recorded one, so every repair round produced a plan with no anchored base
//     and silently lost the base-rooted integration ADR-0035 introduced — the
//     exact "patch applied to a tree it was not authored against" dead end that
//     ADR removed, reintroduced on precisely the rounds most likely to hit it.
//  2. It measures how the local project diverged from the snapshot the planner
//     already holds, and records that report so the prompt and every transport
//     describe the same divergence.
//
// Both are best effort. A project without Git, or any Git refusal, degrades to
// the previous behavior rather than failing a correction the user asked for.
func (s *Service) prepareContinuation(ctx context.Context, item domain.Session, requestID, parentRequestID string) {
	requestID = strings.TrimSpace(requestID)
	parentRequestID = strings.TrimSpace(parentRequestID)
	if requestID == "" || strings.TrimSpace(item.ProjectPath) == "" {
		return
	}
	baseCommit := s.captureRequestBase(ctx, item.ID, item.ProjectPath, requestID)
	rootID := knowledgeReviewRoot(item, parentRequestID)
	delta := s.computeContextDelta(ctx, item, rootID, requestID, baseCommit)

	var released []string
	_, _ = s.store.Update(item.ID, func(current *domain.Session) error {
		released = recordRequestBaseCommit(current, requestID, baseCommit)
		recordRequestContextDelta(current, requestID, delta)
		return nil
	})
	s.releaseRequestBaseRefs(ctx, item.ID, item.ProjectPath, released)
	if s.bus != nil && delta.Protocol != "" {
		s.bus.Publish(item.ID, "context.delta_measured", map[string]any{
			"request_id": requestID, "base_request_id": delta.BaseRequestID, "source": delta.Source,
			"unchanged": delta.Unchanged, "files": len(delta.Files), "truncated": delta.Truncated,
			"patch_attached": delta.Patch != "",
		})
	}
}

// continuationRound reports where a request sits in its Main Request's
// automated budget. Round is one-based and counts every measured round plus the
// one being prepared, so the planner's "is this my last chance" decision uses
// the same numbers Wharnex enforces.
func continuationRound(item domain.Session, rootID string) (round, bound int) {
	bound = policyForEffort(item.EffortLevel).MaxAttempts
	if ledger := attemptLedgerForRoot(item, rootID); ledger != nil {
		return len(ledger.Rounds) + 1, bound
	}
	return 1, bound
}

// withContinuationContext attaches the attempt ledger and divergence report to
// a planner request. Both are rendered here, from state already persisted by
// prepareContinuation, so every transport and the prompt agree by construction.
func (s *Service) withContinuationContext(request planner.Request, item domain.Session) planner.Request {
	rootID := knowledgeReviewRoot(item, strings.TrimSpace(request.ParentRequestID))
	if rootID == "" {
		rootID = strings.TrimSpace(request.RequestID)
	}
	round, bound := continuationRound(item, rootID)
	request.AttemptRound = round
	request.AttemptBound = bound
	request.AttemptLedger = renderAttemptLedger(attemptLedgerForRoot(item, rootID), round, bound)
	if delta, ok := requestContextDelta(item, request.RequestID); ok {
		request.ContextDelta = renderContextDelta(delta)
	}
	return request
}

// continuationArtifacts materializes the request-side files of
// harness.attempts/v1 and harness.context-delta/v1 for one request.
//
// Every transport (Desktop archive, remote one-shot ZIP, live channel file map)
// writes exactly these, so a planner that reads files rather than prose sees
// the identical evidence the prompt describes.
type continuationArtifact struct {
	Name string
	Raw  []byte
}

// ContinuationArtifact is one request-side continuation file exposed to the
// Desktop transport. Name is a fixed Wharnex-generated bundle path; Raw is the
// exact bytes the prompt described.
type ContinuationArtifact struct {
	Name string
	Raw  []byte
}

// RequestContinuationArtifacts returns the harness.attempts/v1 and
// harness.context-delta/v1 files one request must carry, so the Desktop can
// expand them into the outer ChatGPT archive alongside the knowledge records.
func (s *Service) RequestContinuationArtifacts(sessionID, requestID string) []ContinuationArtifact {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return nil
	}
	internal := continuationArtifacts(item, requestID)
	out := make([]ContinuationArtifact, 0, len(internal))
	for _, artifact := range internal {
		out = append(out, ContinuationArtifact{Name: artifact.Name, Raw: artifact.Raw})
	}
	return out
}

// RequestContinuationArtifactsWithHistory expands the compact attempt ledger
// with the durable evidence it summarizes: every execution/recovery event and
// every prior response bundle in this Main Request. The files are engine-owned
// and read-only. Failure to recover one historical object is recorded in the
// index and never blocks the current request.
func (s *Service) RequestContinuationArtifactsWithHistory(ctx context.Context, sessionID, requestID string) []ContinuationArtifact {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return nil
	}
	out := s.RequestContinuationArtifacts(sessionID, requestID)
	rootID := requestRootFor(item, requestID)
	requestIDs := requestIDsForRoot(item, rootID)

	if raw := s.executionHistoryJSON(sessionID, item, rootID, requestIDs); len(raw) > 0 {
		out = append(out, ContinuationArtifact{Name: "attempts/events.json", Raw: raw})
	}
	responses, index := s.responseHistory(ctx, item, requestIDs)
	out = append(out, responses...)
	if len(index) > 0 {
		out = append(out, ContinuationArtifact{Name: "responses/index.json", Raw: index})
	}
	return out
}

func requestRootFor(item domain.Session, requestID string) string {
	requestID = strings.TrimSpace(requestID)
	if lineage, ok := item.RequestLineages[requestID]; ok && strings.TrimSpace(lineage.RootRequestID) != "" {
		return strings.TrimSpace(lineage.RootRequestID)
	}
	return requestID
}

func requestIDsForRoot(item domain.Session, rootID string) map[string]bool {
	ids := map[string]bool{}
	if rootID != "" {
		ids[rootID] = true
	}
	for id, lineage := range item.RequestLineages {
		if strings.TrimSpace(lineage.RootRequestID) == rootID {
			ids[id] = true
		}
	}
	return ids
}

func eventReferencesRequest(event domain.Event, requestIDs map[string]bool) bool {
	for _, key := range []string{"request_id", "root_request_id", "replaces_request_id", "parent_request_id"} {
		if value, ok := event.Data[key].(string); ok && requestIDs[strings.TrimSpace(value)] {
			return true
		}
	}
	return false
}

func eventRequestID(event domain.Event, requestIDs map[string]bool) string {
	for _, key := range []string{"request_id", "root_request_id", "replaces_request_id", "parent_request_id"} {
		if value, ok := event.Data[key].(string); ok {
			value = strings.TrimSpace(value)
			if requestIDs[value] {
				return value
			}
		}
	}
	return ""
}

func executionHistoryEvent(eventType string) bool {
	for _, prefix := range []string{"execution.", "command.", "patch.", "verification.", "integration.", "host.", "automation.", "repair.", "workflow.", "bundle.", "turn.", "request.", "baseline.", "changeset."} {
		if strings.HasPrefix(eventType, prefix) {
			return true
		}
	}
	return false
}

func (s *Service) executionHistoryJSON(sessionID string, item domain.Session, rootID string, requestIDs map[string]bool) []byte {
	if s.bus == nil {
		return nil
	}
	history := s.bus.History(sessionID)
	start := -1
	for index, event := range history {
		if eventReferencesRequest(event, requestIDs) {
			start = index
			break
		}
	}
	if start < 0 {
		return nil
	}
	type executionWave struct {
		RequestID string         `json:"request_id"`
		Kind      string         `json:"kind"`
		Events    []domain.Event `json:"events"`
	}
	lineages := make([]domain.RequestLineage, 0, len(requestIDs))
	for requestID := range requestIDs {
		lineage, ok := item.RequestLineages[requestID]
		if !ok {
			lineage = domain.RequestLineage{RequestID: requestID, RootRequestID: rootID, Kind: requestKindStandard}
		}
		if strings.TrimSpace(lineage.Kind) == "" {
			lineage.Kind = requestKindStandard
		}
		lineages = append(lineages, lineage)
	}
	sort.SliceStable(lineages, func(i, j int) bool {
		if lineages[i].RequestID == rootID {
			return true
		}
		if lineages[j].RequestID == rootID {
			return false
		}
		if lineages[i].CreatedAt.Equal(lineages[j].CreatedAt) {
			return lineages[i].RequestID < lineages[j].RequestID
		}
		return lineages[i].CreatedAt.Before(lineages[j].CreatedAt)
	})
	waves := make([]executionWave, 0, len(lineages))
	waveByRequest := make(map[string]int, len(lineages))
	for _, lineage := range lineages {
		waveByRequest[lineage.RequestID] = len(waves)
		waves = append(waves, executionWave{RequestID: lineage.RequestID, Kind: lineage.Kind, Events: []domain.Event{}})
	}
	activeRequestID := rootID
	for _, event := range history[start:] {
		if !executionHistoryEvent(event.Type) {
			continue
		}
		if explicit := eventRequestID(event, requestIDs); explicit != "" {
			activeRequestID = explicit
		}
		if index, ok := waveByRequest[activeRequestID]; ok {
			waves[index].Events = append(waves[index].Events, event)
		}
	}
	raw, err := marshalIndented(map[string]any{
		"protocol": "harness.execution-history/v1", "root_request_id": rootID, "waves": waves,
	})
	if err != nil {
		return nil
	}
	return raw
}

func safeResponseRequestID(value, fallback string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		value = fallback
	}
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_' || r == '-' {
			continue
		}
		return fallback
	}
	return value
}

func (s *Service) responseHistory(ctx context.Context, item domain.Session, requestIDs map[string]bool) ([]ContinuationArtifact, []byte) {
	type responseIndexEntry struct {
		Path      string `json:"path,omitempty"`
		RequestID string `json:"request_id"`
		Name      string `json:"original_name"`
		SHA256    string `json:"sha256"`
		Bytes     int64  `json:"bytes"`
		ReadError string `json:"read_error,omitempty"`
	}
	records := make([]domain.ArtifactRecord, 0)
	for _, record := range item.Artifacts {
		if record.Direction == "output" && record.Kind == "bundle" && requestIDs[record.RequestID] {
			records = append(records, record)
		}
	}
	sort.Slice(records, func(i, j int) bool { return records[i].CreatedAt.Before(records[j].CreatedAt) })
	if len(records) == 0 {
		return nil, nil
	}
	files := make([]ContinuationArtifact, 0, len(records))
	index := make([]responseIndexEntry, 0, len(records))
	for position, record := range records {
		entry := responseIndexEntry{RequestID: record.RequestID, Name: record.Name, SHA256: record.SHA256, Bytes: record.Size}
		if s.artifactStore == nil || record.ObjectKey == "" {
			entry.ReadError = "artifact storage unavailable"
			index = append(index, entry)
			continue
		}
		raw, _, readErr := s.artifactStore.Get(ctx, record.ObjectKey)
		if readErr != nil {
			entry.ReadError = truncateRepairText(readErr.Error(), 300)
			index = append(index, entry)
			continue
		}
		entry.Path = fmt.Sprintf("responses/%03d-%s.zip", position+1, safeResponseRequestID(record.RequestID, record.ID))
		entry.Bytes = int64(len(raw))
		files = append(files, ContinuationArtifact{Name: entry.Path, Raw: raw})
		index = append(index, entry)
	}
	raw, err := marshalIndented(map[string]any{
		"protocol": "harness.response-history/v1", "responses": index,
	})
	if err != nil {
		return files, nil
	}
	return files, raw
}

func continuationArtifacts(item domain.Session, requestID string) []continuationArtifact {
	requestID = strings.TrimSpace(requestID)
	if requestID == "" {
		return nil
	}
	lineage, ok := item.RequestLineages[requestID]
	rootID := requestID
	if ok && lineage.RootRequestID != "" {
		rootID = lineage.RootRequestID
	}
	out := make([]continuationArtifact, 0, 5)
	if rootID != requestID {
		for _, artifact := range item.RequestSupportArtifacts[rootID] {
			if artifact.Path == mainRequestArtifactPath && len(artifact.Content) > 0 {
				out = append(out, continuationArtifact{Name: mainRequestArtifactPath, Raw: append([]byte(nil), artifact.Content...)})
			}
		}
	}
	if artifact := latestAdjustmentSupportArtifact(item, requestID, rootID); artifact != nil {
		out = append(out, continuationArtifact{Name: adjustmentRequestArtifactPath, Raw: append([]byte(nil), artifact.Content...)})
	}
	if ledger := attemptLedgerForRoot(item, rootID); ledger != nil {
		round, bound := continuationRound(item, rootID)
		if state := attemptLedgerStateJSON(ledger, requestID, round, bound); state != nil {
			if raw, err := marshalIndented(state); err == nil {
				out = append(out, continuationArtifact{Name: "attempts/state.json", Raw: raw})
			}
		}
		if narrative := strings.TrimSpace(ledger.Narrative); narrative != "" {
			out = append(out, continuationArtifact{Name: "attempts/ledger.md", Raw: []byte(narrative)})
		}
	}
	if delta, exists := requestContextDelta(item, requestID); exists {
		if raw, err := marshalIndented(delta); err == nil {
			out = append(out, continuationArtifact{Name: "context-delta/delta.json", Raw: raw})
		}
		if delta.Patch != "" {
			out = append(out, continuationArtifact{Name: "context-delta/delta.patch", Raw: []byte(delta.Patch)})
		}
	}
	for _, artifact := range item.RequestSupportArtifacts[requestID] {
		if (artifact.Path == conflictCapsuleArtifactPath || (rootID == requestID && artifact.Path == mainRequestArtifactPath)) && len(artifact.Content) > 0 {
			out = append(out, continuationArtifact{Name: artifact.Path, Raw: append([]byte(nil), artifact.Content...)})
		}
	}
	return out
}

func latestAdjustmentSupportArtifact(item domain.Session, requestID, rootID string) *domain.RequestSupportArtifact {
	for currentID := requestID; currentID != ""; {
		for _, artifact := range item.RequestSupportArtifacts[currentID] {
			if artifact.Path == adjustmentRequestArtifactPath && len(artifact.Content) > 0 {
				copy := artifact
				return &copy
			}
		}
		if currentID == rootID {
			break
		}
		lineage, ok := item.RequestLineages[currentID]
		if !ok || strings.TrimSpace(lineage.ParentRequestID) == "" || lineage.ParentRequestID == currentID {
			break
		}
		currentID = lineage.ParentRequestID
	}
	return nil
}

// recordRequestSupportArtifact persists a fixed-path, engine-authored request
// file. The oldest inactive request records are bounded with the same 24-round
// horizon used by immutable request contexts.
func recordRequestSupportArtifact(item *domain.Session, requestID, path string, raw []byte) {
	if item == nil || strings.TrimSpace(requestID) == "" || len(raw) == 0 {
		return
	}
	if path != conflictCapsuleArtifactPath && path != mainRequestArtifactPath && path != adjustmentRequestArtifactPath {
		return
	}
	if item.RequestSupportArtifacts == nil {
		item.RequestSupportArtifacts = make(map[string][]domain.RequestSupportArtifact)
	}
	artifacts := item.RequestSupportArtifacts[requestID]
	replaced := false
	for index := range artifacts {
		if artifacts[index].Path == path {
			artifacts[index] = domain.RequestSupportArtifact{Path: path, Content: append([]byte(nil), raw...)}
			replaced = true
			break
		}
	}
	if !replaced {
		artifacts = append(artifacts, domain.RequestSupportArtifact{Path: path, Content: append([]byte(nil), raw...)})
	}
	item.RequestSupportArtifacts[requestID] = artifacts
	if len(item.RequestSupportArtifacts) <= maxRequestSupportArtifacts {
		return
	}
	ids := make([]string, 0, len(item.RequestSupportArtifacts))
	for id := range item.RequestSupportArtifacts {
		if id != item.LastRequestID && id != requestID {
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	for _, id := range ids {
		delete(item.RequestSupportArtifacts, id)
		if len(item.RequestSupportArtifacts) <= maxRequestSupportArtifacts {
			break
		}
	}
}
