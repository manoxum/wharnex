package app

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"

	"kernl.local/harness/backend/internal/directives"
	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/ids"
	"kernl.local/harness/backend/internal/planner"
)

// ComposerBundlePreviewRequest describes the draft that the chat composer would
// submit next. Previewing it must not allocate a real planner request or mutate
// the request lineage; the returned ZIP is a disposable managed artifact.
type ComposerBundlePreviewRequest struct {
	Message      string            `json:"message"`
	PlanningMode string            `json:"planning_mode"`
	Attachments  []RemoteInputFile `json:"attachments"`
	Artifacts    []RemoteInputFile `json:"artifacts"`
	ProjectFiles []string          `json:"project_files"`
}

func (s *Service) PreviewComposerBundle(ctx context.Context, sessionID string, input ComposerBundlePreviewRequest) (domain.ArtifactRecord, error) {
	if s.artifactStore == nil {
		return domain.ArtifactRecord{}, errors.New("artifact storage is unavailable")
	}
	item, err := s.store.Get(sessionID)
	if err != nil {
		return domain.ArtifactRecord{}, err
	}
	message := directives.Canonicalize(strings.TrimSpace(input.Message))
	if message == "" || len(message) > maxRemotePromptBytes {
		return domain.ArtifactRecord{}, errors.New("preview message is empty or exceeds 1 MiB")
	}
	planningMode := strings.ToLower(strings.TrimSpace(input.PlanningMode))
	if planningMode == "" {
		planningMode = "direct"
	}
	if planningMode != "direct" && planningMode != "plan_first" {
		return domain.ArtifactRecord{}, errors.New("preview planning_mode must be direct or plan_first")
	}

	previewID := ids.New("req")
	external, refused := s.resolveMessageAttachments(sessionID, message)
	grant, unresolved := s.crossProjectGrantForRequest(item, message, previewID, "")
	relatedPaths := append([]string(nil), item.RelatedProjectPaths...)
	if grant != nil {
		for _, project := range grant.Projects {
			if !containsString(relatedPaths, project.ProjectPath) {
				relatedPaths = append(relatedPaths, project.ProjectPath)
			}
		}
	}
	bundle, err := s.context.BuildWorkspaceWithSelections(item.ProjectPath, relatedPaths, nil, external)
	if err != nil {
		return domain.ArtifactRecord{}, err
	}
	previewItem := item
	previewItem.Context = bundle
	if selections := s.referenceSelections(previewItem, message); len(selections) > 0 {
		firstDir := filepath.Dir(bundle.ZipPath)
		selected, buildErr := s.context.BuildWorkspaceWithSelections(item.ProjectPath, relatedPaths, selections, external)
		if buildErr != nil {
			_ = os.RemoveAll(firstDir)
			return domain.ArtifactRecord{}, buildErr
		}
		_ = os.RemoveAll(firstDir)
		bundle = selected
		previewItem.Context = bundle
	}
	defer os.RemoveAll(filepath.Dir(bundle.ZipPath))

	message += directiveLegendWithContext(message, bundle)
	message = messageWithRelatedProjects(message, item.ProjectPath, bundle.RelatedProjects, grantedProjectPaths(grant))
	message = messageWithCrossProjectGrant(message, grant, unresolved, s.openGrantedProjects(grant))
	message = messageWithAttachments(message, bundle.Attachments, refused)
	message = messageWithPendingHostChanges(message, item.PendingHostChanges, item.LastRepairError)

	// Mirror the fresh Main Request lifecycle in-memory only. The real submit
	// resets the attempt ledger before it builds the prompt and transport, so a
	// faithful preview must carry the same first-round attempts/state.json
	// without mutating the live session.
	resetAttemptLedger(&previewItem, previewID)
	previewItem.AutomationAttempt = 1
	previewItem.ImprovementAttempt = 0

	knowledge, err := s.previewRequestKnowledge(item)
	if err != nil {
		return domain.ArtifactRecord{}, err
	}
	plannerRequest := s.plannerRequest(ctx, planner.Request{
		RequestID:              previewID,
		Message:                message,
		ContextTextPath:        bundle.TextPath,
		ContextManifest:        bundle.Manifest,
		ContextMode:            domain.EffectiveContextMode(item.ContextMode),
		PreviousResponseID:     item.LastProviderResponseID,
		AutomationMode:         item.AutomationMode,
		SelfEvolution:          s.isSelfEvolution(item),
		PlanningMode:           planningMode,
		EffortLevel:            normalizeEffortLevel(item.EffortLevel),
		ExpectedBundleFilename: expectedResponseBundleFilename(previewItem, previewID),
	}, knowledge, item.ProjectPath)
	plannerRequest = s.withContinuationContext(plannerRequest, previewItem)
	prompt := planner.BuildManualPrompt(plannerRequest)

	attachments, err := decodeRemoteFiles(input.Attachments, maxRemoteAttachmentBytes)
	if err != nil {
		return domain.ArtifactRecord{}, err
	}
	artifacts, err := decodeRemoteFiles(input.Artifacts, maxRemoteArtifactBytes)
	if err != nil {
		return domain.ArtifactRecord{}, err
	}
	projectFiles, err := validateProjectFileReferences(previewItem, input.ProjectFiles)
	if err != nil {
		return domain.ArtifactRecord{}, err
	}
	request := RemoteInputRequest{RequestID: previewID, Prompt: prompt, IncludeContext: true, ContextMode: domain.EffectiveContextMode(item.ContextMode), ProjectFiles: projectFiles}
	target, err := os.CreateTemp("", "whx-composer-preview-*.zip")
	if err != nil {
		return domain.ArtifactRecord{}, err
	}
	targetPath := target.Name()
	_ = target.Close()
	defer os.Remove(targetPath)
	gitContext := requestGitContextForItem(ctx, previewItem)
	if _, _, err = buildRemoteInputArchive(targetPath, bundle.ZipPath, bundle.Manifest, request, knowledge, gitContext, continuationArtifacts(previewItem, previewID), attachments, artifacts); err != nil {
		return domain.ArtifactRecord{}, err
	}
	raw, err := os.ReadFile(targetPath)
	if err != nil {
		return domain.ArtifactRecord{}, err
	}
	return s.PersistArtifact(ctx, sessionID, previewID, "input", "bundle-preview", requestBundleFilename(previewItem, previewID), "application/zip", raw)
}

func grantedProjectPaths(grant *domain.CrossProjectGrant) []string {
	if grant == nil {
		return nil
	}
	paths := make([]string, 0, len(grant.Projects))
	for _, project := range grant.Projects {
		paths = append(paths, project.ProjectPath)
	}
	return paths
}

func (s *Service) previewRequestKnowledge(item domain.Session) (domain.RequestKnowledgeSnapshot, error) {
	catalog, err := s.loadProjectKnowledgeCatalog(item.ID, item.ProjectPath)
	if err != nil {
		return domain.RequestKnowledgeSnapshot{}, err
	}
	sharing := knowledgeSharingEnabled(item) || catalog.Revision > item.KnowledgeLastSeenRevision
	entries := effectivePendingKnowledge(item, catalog)
	snapshot := domain.RequestKnowledgeSnapshot{
		Protocol: domain.KnowledgeProtocolV2, Revision: catalog.Revision, SharingEnabled: sharing,
		BaseEntries: append([]domain.ProjectKnowledgeEntry(nil), catalog.Entries...),
	}
	if sharing && len(entries) > 0 {
		snapshot.State = domain.KnowledgeStatePresent
		snapshot.Entries = entries
		snapshot.SHA256 = knowledgeCatalogDigest(entries)
		snapshot.Content = knowledgeProjection(entries)
		snapshot.Version = int(catalog.Revision)
		snapshot.UpdatedByRequestID = catalog.UpdatedByRequestID
	} else {
		snapshot.State = domain.KnowledgeStateNone
	}
	if err := validateRequestKnowledgeSnapshot(snapshot); err != nil {
		return domain.RequestKnowledgeSnapshot{}, err
	}
	return snapshot, nil
}
