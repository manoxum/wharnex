package app

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"

	"kernl.local/harness/backend/internal/domain"
)

const orchestratorContextRequestProtocol = "harness.orchestrator-context-request/v1"

type orchestratorContextRequest struct {
	Protocol     string   `json:"protocol"`
	RequestID    string   `json:"request_id"`
	ContextPaths []string `json:"context_paths"`
}

func decodeOrchestratorContextRequest(raw []byte) (orchestratorContextRequest, bool, error) {
	if len(raw) == 0 || len(raw) > maxOrchestratorBundleBytes {
		return orchestratorContextRequest{}, false, errors.New("orchestrator response bundle size is invalid")
	}
	reader, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		return orchestratorContextRequest{}, false, err
	}
	if len(reader.File) > maxOrchestratorBundleEntries {
		return orchestratorContextRequest{}, false, errors.New("orchestrator response has too many entries")
	}
	var selected *zip.File
	hasPlan := false
	for _, file := range reader.File {
		name, err := safeOrchestratorBundleEntry(file.Name)
		if err != nil {
			return orchestratorContextRequest{}, false, err
		}
		if name != OrchestratorPlanBundleEntry && name != "context-request.json" && name != "README.md" {
			return orchestratorContextRequest{}, false, errors.New("unexpected orchestrator response entry")
		}
		if name == OrchestratorPlanBundleEntry {
			hasPlan = true
		}
		if name == "context-request.json" {
			if selected != nil {
				return orchestratorContextRequest{}, false, errors.New("duplicate context-request.json")
			}
			selected = file
		}
	}
	if hasPlan && selected != nil {
		return orchestratorContextRequest{}, false, errors.New("orchestrator response cannot mix plan and context request")
	}
	if hasPlan {
		return orchestratorContextRequest{}, false, nil
	}
	if selected == nil {
		return orchestratorContextRequest{}, false, nil
	}
	if selected.UncompressedSize64 > 64<<10 {
		return orchestratorContextRequest{}, false, errors.New("context request exceeds 64 KiB")
	}
	opened, err := selected.Open()
	if err != nil {
		return orchestratorContextRequest{}, false, err
	}
	defer opened.Close()
	var request orchestratorContextRequest
	decoder := json.NewDecoder(io.LimitReader(opened, (64<<10)+1))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		return orchestratorContextRequest{}, false, err
	}
	if request.Protocol != orchestratorContextRequestProtocol || request.RequestID == "" || len(request.ContextPaths) == 0 {
		return orchestratorContextRequest{}, false, errors.New("invalid orchestrator context request")
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		return orchestratorContextRequest{}, false, errors.New("context request has trailing JSON")
	}
	return request, true, nil
}

func (s *Service) importOrchestratorContextRequest(ctx context.Context, sessionID, requestID string, request orchestratorContextRequest, raw []byte) (OrchestratorProposalResult, error) {
	if request.RequestID != requestID {
		return OrchestratorProposalResult{}, errors.New("orchestrator context request_id mismatch")
	}
	item, err := s.EnsureContextArtifacts(sessionID)
	if err != nil {
		return OrchestratorProposalResult{}, err
	}
	if domain.EffectiveContextMode(item.ContextMode) != domain.ContextModePartial {
		return OrchestratorProposalResult{}, errors.New("orchestrator context request requires Partial mode")
	}
	previous := item.OrchestratorContextPaths[requestID]
	previousSet := make(map[string]struct{}, len(previous))
	for _, path := range previous {
		previousSet[path] = struct{}{}
	}
	repeated := true
	for _, path := range request.ContextPaths {
		if _, ok := previousSet[path]; !ok {
			repeated = false
			break
		}
	}
	if repeated {
		return OrchestratorProposalResult{RequestID: requestID, ContextPaths: append([]string(nil), previous...), Delivery: "context_increment"}, nil
	}
	if item.OrchestratorContextRounds[requestID] >= maxWorkflowRounds {
		return OrchestratorProposalResult{}, errors.New("orchestrator context increment limit reached")
	}
	paths, err := selectContextPaths(item.Context.ZipPath, previous, request.ContextPaths)
	if err != nil {
		return OrchestratorProposalResult{}, err
	}
	if _, err = s.store.Update(sessionID, func(current *domain.Session) error {
		if current.OrchestratorContextPaths == nil {
			current.OrchestratorContextPaths = make(map[string][]string)
		}
		if current.OrchestratorContextRounds == nil {
			current.OrchestratorContextRounds = make(map[string]int)
		}
		current.OrchestratorContextPaths[requestID] = paths
		current.OrchestratorContextRounds[requestID]++
		return nil
	}); err != nil {
		return OrchestratorProposalResult{}, err
	}
	if _, err := s.PersistArtifact(ctx, sessionID, requestID, "output", "bundle", "whx_bundle_res_orchestrator_"+requestID+".zip", "application/zip", raw); err != nil {
		s.bus.Publish(sessionID, "orchestrator.context_bundle_unpersisted", map[string]any{"request_id": requestID, "error": err.Error()})
	}
	ranking := contextMapSelectionRankingMetrics(item.Context.ZipPath, item.Context.Manifest, requestContextMapState{SelectedPaths: previous, RoundsUsed: item.OrchestratorContextRounds[requestID]}, request.ContextPaths)
	s.bus.Publish(sessionID, "orchestrator.context_incremented", map[string]any{
		"request_id": requestID, "added": len(request.ContextPaths), "selected": len(paths), "selected_bytes": selectedContextBytes(item.Context.ZipPath, paths), "round": item.OrchestratorContextRounds[requestID] + 1,
		"ranking_candidates": ranking.Candidates, "ranking_requested": ranking.RequestedRanked, "ranking_top10_hits": ranking.TopTenHits, "ranking_request_match_hits": ranking.RequestMatchHits, "ranking_position_sum": ranking.RankPositionSum,
	})
	return OrchestratorProposalResult{RequestID: requestID, ContextPaths: paths, Delivery: "context_increment"}, nil
}
