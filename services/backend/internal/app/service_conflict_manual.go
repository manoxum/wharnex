package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/hostrepo"
	"kernl.local/harness/backend/internal/planner"
)

// ConflictWorkbench is the complete, untruncated three-way view used by the
// local merge tool. GPT capsules stay bounded; humans must be able to inspect
// the actual file before deciding which side to keep or how to combine it.
type ConflictWorkbench struct {
	ID          string                  `json:"id"`
	RequestID   string                  `json:"request_id"`
	Files       []ConflictWorkbenchFile `json:"files"`
	ManualPaths []string                `json:"manual_paths,omitempty"`
}

type ConflictWorkbenchFile struct {
	Path           string `json:"path"`
	BaseExists     bool   `json:"base_exists"`
	CurrentExists  bool   `json:"current_exists"`
	IncomingExists bool   `json:"incoming_exists"`
	Base           string `json:"base"`
	Current        string `json:"current"`
	Incoming       string `json:"incoming"`
}

type ConflictManualResolution struct {
	Path    string `json:"path"`
	Content string `json:"content"`
	Exists  bool   `json:"exists"`
}

type ConflictManualResult struct {
	Session domain.Session `json:"session"`
	Applied bool           `json:"applied"`
}

func (s *Service) ConflictWorkbench(ctx context.Context, sessionID string) (ConflictWorkbench, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return ConflictWorkbench{}, err
	}
	return s.conflictWorkbench(ctx, item)
}

func (s *Service) conflictWorkbench(ctx context.Context, item domain.Session) (ConflictWorkbench, error) {
	conflict := item.IntegrationConflict
	if conflict == nil {
		return ConflictWorkbench{}, errors.New("no active conflict")
	}
	result := ConflictWorkbench{ID: conflict.ID, RequestID: conflict.RequestID, ManualPaths: append([]string(nil), conflict.ManualPaths...)}
	for _, path := range conflict.Paths {
		file := ConflictWorkbenchFile{Path: path}
		if conflict.Git != nil {
			file.Base, file.BaseExists = hostrepo.FileAtRef(ctx, item.ProjectPath, conflict.Git.BaseSHA, path)
			file.Current, file.CurrentExists = hostrepo.FileAtRef(ctx, item.ProjectPath, conflict.Git.OursSHA, path)
			file.Incoming, file.IncomingExists = hostrepo.FileAtRef(ctx, item.ProjectPath, conflict.Git.TheirsSHA, path)
		} else {
			var detail *domain.IntegrationConflictDetail
			for index := range conflict.Details {
				if conflict.Details[index].Path == path {
					detail = &conflict.Details[index]
					break
				}
			}
			if detail == nil {
				return ConflictWorkbench{}, fmt.Errorf("missing conflict detail for %s", path)
			}
			mutation, ok := mutationForConflict(item.PendingHostChanges, detail.ChangeSetID, path)
			if !ok {
				return ConflictWorkbench{}, fmt.Errorf("missing conflict mutation for %s", path)
			}
			file.Base, file.BaseExists = mutation.BaseContent, mutation.BaseExists
			file.Incoming, file.IncomingExists = mutation.ResultContent, mutation.ResultExists
			current, readErr := os.ReadFile(filepath.Join(item.ProjectPath, filepath.FromSlash(path)))
			file.CurrentExists = readErr == nil
			if readErr != nil && !errors.Is(readErr, os.ErrNotExist) {
				return ConflictWorkbench{}, fmt.Errorf("read current conflict path %s: %w", path, readErr)
			}
			file.Current = string(current)
		}
		result.Files = append(result.Files, file)
	}
	return result, nil
}

// ResolveConflictManually treats the operator's edited Result panes as the
// final authority. For candidate conflicts it runs the ordinary protected
// verification+apply path; Git-origin conflicts conclude the exact merge that
// the operator started.
func (s *Service) ResolveConflictManually(ctx context.Context, sessionID string, resolutions []ConflictManualResolution) (ConflictManualResult, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return ConflictManualResult{}, err
	}
	workbench, err := s.conflictWorkbench(ctx, item)
	if err != nil {
		return ConflictManualResult{}, err
	}
	patch, paths, err := buildManualConflictPatch(ctx, workbench, resolutions, true)
	if err != nil {
		return ConflictManualResult{}, err
	}
	plan := manualConflictPlan(item, paths, patch)
	item.IntegrationConflict.ManualPaths = paths
	item.IntegrationConflict.ManualPatch = patch
	if item.IntegrationConflict.Git != nil {
		resolved, resolveErr := s.concludeGitConflict(ctx, sessionID, item, &plan)
		return ConflictManualResult{Session: resolved, Applied: resolveErr == nil}, resolveErr
	}
	decision := s.policy.Evaluate(plan)
	_, err = s.store.Update(sessionID, func(current *domain.Session) error {
		if current.IntegrationConflict == nil || current.IntegrationConflict.ID != workbench.ID {
			return errors.New("conflict changed while manual resolution was open")
		}
		current.IntegrationConflict.ManualPaths = append([]string(nil), paths...)
		current.IntegrationConflict.ManualPatch = patch
		current.Plan = &plan
		current.Policy = &decision
		current.State = "planned"
		return nil
	})
	if err != nil {
		return ConflictManualResult{}, err
	}
	execution, executed, execErr := s.Execute(ctx, sessionID, true)
	_ = execution
	if execErr != nil {
		return ConflictManualResult{Session: executed}, execErr
	}
	if len(hostApplicablePendingChanges(pendingHostChanges(executed))) == 0 {
		return ConflictManualResult{Session: executed}, nil
	}
	applied, applyErr := s.ApplyToHost(ctx, sessionID)
	if applyErr != nil {
		if latest, getErr := s.store.Get(sessionID); getErr == nil {
			applied = latest
		}
		return ConflictManualResult{Session: applied}, applyErr
	}
	return ConflictManualResult{Session: applied, Applied: true}, nil
}

// DelegateConflictToGPT locks the paths already completed by the operator and
// rebuilds the pending prompt for only the remaining paths. The backend later
// injects ManualPatch into the returned GPT plan, so the model cannot rewrite
// an accepted human decision.
func (s *Service) DelegateConflictToGPT(ctx context.Context, sessionID string, resolutions []ConflictManualResolution) (domain.Session, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return item, err
	}
	workbench, err := s.conflictWorkbench(ctx, item)
	if err != nil {
		return item, err
	}
	patch, manualPaths, err := buildManualConflictPatch(ctx, workbench, resolutions, false)
	if err != nil {
		return item, err
	}
	manual := make(map[string]bool, len(manualPaths))
	for _, path := range manualPaths {
		manual[path] = true
	}
	remaining := make([]string, 0, len(workbench.Files))
	files := make([]conflictCapsuleFile, 0, len(workbench.Files))
	for _, file := range workbench.Files {
		if manual[file.Path] {
			continue
		}
		remaining = append(remaining, file.Path)
		files = append(files, conflictCapsuleFile{
			Path: file.Path, Reason: "merge conflict", BaseExists: file.BaseExists, CurrentExists: file.CurrentExists, ResultExists: file.IncomingExists,
			BaseSHA256: hashBytes([]byte(file.Base)), CurrentSHA256: hashBytes([]byte(file.Current)), ResultSHA256: hashBytes([]byte(file.Incoming)),
			Base: truncateRepairText(file.Base, 24000), Current: truncateRepairText(file.Current, 24000), Result: truncateRepairText(file.Incoming, 24000),
		})
	}
	if len(remaining) == 0 {
		return item, errors.New("all conflict paths are already resolved manually; apply the manual resolution instead")
	}
	capsule := conflictCapsule{Protocol: "harness.conflict/v1", ConflictID: workbench.ID, CurrentRevision: item.Context.Manifest.SHA256, OriginalPlanIDs: item.IntegrationConflict.OriginalPlanIDs, Files: files}
	if item.IntegrationConflict.Git != nil {
		g := item.IntegrationConflict.Git
		capsule.Origin = g.Origin
		capsule.Git = &conflictCapsuleGit{Ref: g.Ref, TargetBranch: g.TargetBranch, Remote: g.Remote, BaseSHA: g.BaseSHA, OursSHA: g.OursSHA, TheirsSHA: g.TheirsSHA}
	}
	capsuleJSON, err := json.MarshalIndent(capsule, "", "  ")
	if err != nil {
		return item, err
	}
	message := buildHybridConflictResolutionMessage(remaining, manualPaths)
	knowledgeSnapshot, err := s.loadRequestKnowledge(sessionID, item.ProjectPath)
	if err != nil {
		return item, err
	}
	prompt := planner.BuildManualPrompt(s.plannerRequest(ctx, planner.Request{
		SessionID: sessionID, RequestID: item.IntegrationConflict.RequestID, Message: message,
		ContextTextPath: item.Context.TextPath, ContextManifest: item.Context.Manifest,
		PreviousResponseID: item.LastProviderResponseID, AutomationMode: item.AutomationMode,
		SelfEvolution: s.isSelfEvolution(item), PlanningMode: "direct",
		ExpectedBundleFilename: expectedResponseBundleFilename(item, item.IntegrationConflict.RequestID),
	}, knowledgeSnapshot, item.ProjectPath))
	updated, err := s.store.Update(sessionID, func(current *domain.Session) error {
		recordRequestSupportArtifact(current, item.IntegrationConflict.RequestID, conflictCapsuleArtifactPath, capsuleJSON)
		if current.IntegrationConflict == nil || current.IntegrationConflict.ID != workbench.ID {
			return errors.New("conflict changed while manual resolution was open")
		}
		current.IntegrationConflict.ManualPaths = append([]string(nil), manualPaths...)
		current.IntegrationConflict.ManualPatch = patch
		current.LastManualPrompt = prompt
		current.State = "conflict_resolution_pending"
		return nil
	})
	if err == nil {
		s.bus.Publish(sessionID, "conflict.manual_delegated", map[string]any{"conflict_id": workbench.ID, "manual_paths": manualPaths, "remaining_paths": remaining})
	}
	return updated, err
}
