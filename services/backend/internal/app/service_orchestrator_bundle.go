package app

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"path"
	"strings"

	"kernl.local/harness/backend/internal/orchestrator"
)

// Orchestrator planning delivers its result as a response bundle, the same ZIP
// transport every other planner artifact uses, rather than a bare JSON file of
// its own. One transport means one naming contract, one download path and one
// place where untrusted planner bytes are validated.
const (
	// OrchestratorPlanBundleEntry is the only entry a planning bundle needs.
	OrchestratorPlanBundleEntry = "plan.json"
	// Bounds for the archive itself. A planning result is metadata: a DAG of
	// tasks, never patches or build output.
	maxOrchestratorBundleBytes    = 2 << 20
	maxOrchestratorBundleEntries  = 32
	maxOrchestratorPlanEntryBytes = 2 << 20
)

// ImportOrchestratorProposalBundle validates one orchestrator planning response
// bundle and imports the plan it carries.
//
// The bytes are untrusted planner output, so every structural bound is enforced
// here rather than in the Desktop: the Desktop is transport and never opens the
// archive.
func (s *Service) ImportOrchestratorProposalBundle(ctx context.Context, sessionID, requestID string, raw []byte) (OrchestratorProposalResult, error) {
	if increment, ok, err := decodeOrchestratorContextRequest(raw); err != nil {
		return OrchestratorProposalResult{}, err
	} else if ok {
		return s.importOrchestratorContextRequest(ctx, sessionID, requestID, increment, raw)
	}
	proposal, err := DecodeOrchestratorPlanBundle(raw)
	if err != nil {
		return OrchestratorProposalResult{}, err
	}
	result, err := s.ImportOrchestratorProposal(ctx, sessionID, requestID, proposal)
	if err != nil {
		return result, err
	}
	// Keep the response like the request, so the planning detail can show and
	// explore the bundles exchanged to produce this plan.
	if _, persistErr := s.PersistArtifact(ctx, sessionID, requestID, "output", "bundle", "whx_bundle_res_orchestrator_"+requestID+".zip", "application/zip", raw); persistErr != nil {
		s.bus.Publish(sessionID, "orchestrator.plan_bundle_unpersisted", map[string]any{"request_id": requestID, "error": persistErr.Error()})
	}
	return result, nil
}

// DecodeOrchestratorPlanBundle extracts and decodes plan.json from a planning
// response bundle.
func DecodeOrchestratorPlanBundle(raw []byte) (orchestrator.Proposal, error) {
	if len(raw) == 0 {
		return orchestrator.Proposal{}, errors.New("orchestrator plan bundle is empty")
	}
	if len(raw) > maxOrchestratorBundleBytes {
		return orchestrator.Proposal{}, fmt.Errorf("orchestrator plan bundle exceeds %d bytes", maxOrchestratorBundleBytes)
	}
	reader, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		return orchestrator.Proposal{}, fmt.Errorf("orchestrator plan bundle is not a readable ZIP: %w", err)
	}
	if len(reader.File) > maxOrchestratorBundleEntries {
		return orchestrator.Proposal{}, fmt.Errorf("orchestrator plan bundle has more than %d entries", maxOrchestratorBundleEntries)
	}

	var planEntry *zip.File
	for _, file := range reader.File {
		name, err := safeOrchestratorBundleEntry(file.Name)
		if err != nil {
			return orchestrator.Proposal{}, err
		}
		if name != OrchestratorPlanBundleEntry {
			continue
		}
		if planEntry != nil {
			return orchestrator.Proposal{}, fmt.Errorf("orchestrator plan bundle contains %s more than once", OrchestratorPlanBundleEntry)
		}
		planEntry = file
	}
	if planEntry == nil {
		return orchestrator.Proposal{}, fmt.Errorf("orchestrator plan bundle does not contain %s", OrchestratorPlanBundleEntry)
	}

	opened, err := planEntry.Open()
	if err != nil {
		return orchestrator.Proposal{}, fmt.Errorf("open %s: %w", OrchestratorPlanBundleEntry, err)
	}
	defer func() { _ = opened.Close() }()
	// Read one byte past the bound so a declared-small/actual-large entry is
	// rejected rather than silently truncated.
	planBytes, err := io.ReadAll(io.LimitReader(opened, maxOrchestratorPlanEntryBytes+1))
	if err != nil {
		return orchestrator.Proposal{}, fmt.Errorf("read %s: %w", OrchestratorPlanBundleEntry, err)
	}
	if len(planBytes) > maxOrchestratorPlanEntryBytes {
		return orchestrator.Proposal{}, fmt.Errorf("%s exceeds %d bytes", OrchestratorPlanBundleEntry, maxOrchestratorPlanEntryBytes)
	}

	var proposal orchestrator.Proposal
	decoder := json.NewDecoder(bytes.NewReader(planBytes))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&proposal); err != nil {
		return orchestrator.Proposal{}, fmt.Errorf("decode %s: %w", OrchestratorPlanBundleEntry, err)
	}
	if proposal.Protocol != orchestrator.ProtocolV1 {
		return orchestrator.Proposal{}, fmt.Errorf("%s protocol is %q, want %q", OrchestratorPlanBundleEntry, proposal.Protocol, orchestrator.ProtocolV1)
	}
	return proposal, nil
}

// safeOrchestratorBundleEntry rejects the archive shapes that let an entry name
// escape the bundle: absolute paths, traversal, and backslash separators that a
// Windows-authored archive can carry.
func safeOrchestratorBundleEntry(value string) (string, error) {
	name := strings.ReplaceAll(strings.TrimSpace(value), `\`, "/")
	if name == "" {
		return "", errors.New("orchestrator plan bundle contains an unnamed entry")
	}
	if strings.HasPrefix(name, "/") || strings.Contains(name, "../") || name == ".." {
		return "", fmt.Errorf("orchestrator plan bundle entry %q escapes the archive", value)
	}
	cleaned := path.Clean(name)
	if cleaned == "." || strings.HasPrefix(cleaned, "..") {
		return "", fmt.Errorf("orchestrator plan bundle entry %q escapes the archive", value)
	}
	return cleaned, nil
}
