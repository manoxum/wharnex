package app

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/app/remotemap"
	"kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/domain"
)

func (s *Service) NotifyRemoteInputChannel(sessionID, requestID, comment string) error {
	store, ok := s.remoteInputs.(RemoteInputChannelStore)
	if !ok {
		return nil
	}
	comment = strings.TrimSpace(comment)
	if comment == "" || len(comment) > 16<<10 {
		return errors.New("remote channel comment is empty or exceeds 16 KiB")
	}
	s.remoteLeaseMu.Lock()
	current := s.remoteChannels[sessionID]
	if current == nil || current.activeRequest != strings.TrimSpace(requestID) {
		s.remoteLeaseMu.Unlock()
		return errors.New("remote channel request is not active")
	}
	publications, channelID := append([]RemoteInputPublication(nil), current.publications...), current.channelID
	s.remoteLeaseMu.Unlock()
	return updateRemoteChannelSet(context.Background(), store, publications, RemoteInputChannelUpdate{ChannelID: channelID, Event: "comment.added", Data: map[string]string{"request_id": requestID, "comment": comment}})
}

func (s *Service) monitorRemoteInputChannel(ctx context.Context, sessionID, channelID string) {
	ticker := time.NewTicker(remoteChannelRefreshInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := s.refreshRemoteInputChannelContext(ctx, sessionID, channelID); err != nil {
				s.bus.Publish(sessionID, "remote_channel.refresh_failed", map[string]any{"error": err.Error()})
			}
		}
	}
}

func (s *Service) refreshRemoteInputChannelContext(ctx context.Context, sessionID, channelID string) error {
	store, ok := s.remoteInputs.(RemoteInputChannelStore)
	if !ok {
		return nil
	}
	s.remoteLeaseMu.Lock()
	current := s.remoteChannels[sessionID]
	if current == nil || current.channelID != channelID {
		s.remoteLeaseMu.Unlock()
		return nil
	}
	knownHash, knownProbe, lastChecked := current.contextSHA256, current.contextProbe, current.contextChecked
	s.remoteLeaseMu.Unlock()

	snapshot, err := s.store.Get(sessionID)
	if err != nil {
		return err
	}
	probe, probeErr := contextbundle.SourceProbe(snapshot.ProjectPath)
	now := time.Now()
	if probeErr == nil && probe != "" && probe == knownProbe && now.Sub(lastChecked) < remoteChannelFullRefreshInterval {
		return nil
	}

	item, err := s.refreshContext(sessionID)
	if err != nil {
		return err
	}
	s.remoteLeaseMu.Lock()
	current = s.remoteChannels[sessionID]
	if current == nil || current.channelID != channelID {
		s.remoteLeaseMu.Unlock()
		return nil
	}
	if item.Context.Manifest.SHA256 == knownHash || current.contextSHA256 == item.Context.Manifest.SHA256 {
		if probeErr == nil {
			current.contextProbe = probe
		}
		current.contextChecked = now
		s.remoteLeaseMu.Unlock()
		return nil
	}
	next := *current
	if probeErr == nil {
		next.contextProbe = probe
	}
	next.contextChecked = now
	next.generation++
	next.contextSHA256 = item.Context.Manifest.SHA256
	temporaryDir, err := os.MkdirTemp("", "wharness-channel-context-*")
	if err != nil {
		s.remoteLeaseMu.Unlock()
		return err
	}
	defer os.RemoveAll(temporaryDir)
	resources, err := buildRemoteContextUpdateResources(ctx, temporaryDir, item, &next)
	if err == nil {
		// requestGitContextForItem performs read-only Git commands that can refresh
		// optional index metadata. Persist the post-collection probe to avoid a
		// spurious second context rebuild on the next monitor tick.
		next.contextProbe, _ = contextbundle.SourceProbe(item.ProjectPath)
		next.contextChecked = time.Now()
		err = updateRemoteChannelSet(ctx, store, current.publications, RemoteInputChannelUpdate{ChannelID: channelID, Resources: resources, Event: "context.changed", Data: map[string]string{"generation": strconv.FormatInt(next.generation, 10), "context_sha256": next.contextSHA256}})
	}
	if err == nil {
		current.generation = next.generation
		current.contextSHA256 = next.contextSHA256
		current.contextProbe = next.contextProbe
		current.contextChecked = next.contextChecked
		current.fileMapEntries = next.fileMapEntries
	}
	s.remoteLeaseMu.Unlock()
	if err != nil {
		return err
	}
	s.bus.Publish(sessionID, "remote_channel.context_changed", map[string]any{"generation": next.generation, "context_sha256": next.contextSHA256})
	return nil
}

func buildRemoteContextUpdateResources(ctx context.Context, dir string, item domain.Session, state *remoteInputChannelState) ([]RemoteInputChannelResource, error) {
	hashPath := remoteChannelResourcePath(dir, "hash.txt")
	mapPath := remoteChannelResourcePath(dir, "file-map.json")
	diffCheckPath := remoteChannelResourcePath(dir, "diff-check.json")
	statePath := remoteChannelResourcePath(dir, "state.json")
	for _, path := range []string{hashPath, mapPath, diffCheckPath, statePath} {
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			return nil, err
		}
	}
	resourceURL := func(path string) string { return strings.TrimSuffix(state.baseURL, "/") + "/" + path }
	gitContext := requestGitContextForItem(ctx, item)
	resources, contextEntries, err := buildRemoteFileMapResources(dir, item.Context.ZipPath, item.Context.Manifest, domain.RequestKnowledgeSnapshot{State: domain.KnowledgeStateNone}, gitContext, nil, requestContextMapState{SelectedPaths: remotemap.RetainSelections(item.ContextPaths, state.fileMapEntries), RoundsUsed: item.WorkflowRound}, nil, nil, state.fileMapEntries, resourceURL)
	if err != nil {
		return nil, err
	}
	entries := contextEntries
	for _, entry := range state.fileMapEntries {
		if entry.Role != "context" && entry.Role != "git-context" && entry.Role != "context-map" {
			entries = append(entries, entry)
		}
	}
	fileMapRaw, err := marshalRemoteChannelJSON(remoteFileMapDocument{Protocol: "wharness.remote-file-map/v1", Generation: state.generation, ContextSHA256: item.Context.Manifest.SHA256, Files: entries})
	if err != nil {
		return nil, err
	}
	if err := os.WriteFile(mapPath, fileMapRaw, 0o600); err != nil {
		return nil, err
	}
	if err := os.WriteFile(hashPath, []byte(item.Context.Manifest.SHA256+"\n"), 0o600); err != nil {
		return nil, err
	}
	if err := writeRemoteChannelJSON(diffCheckPath, remoteDiffCheck(state, resourceURL)); err != nil {
		return nil, err
	}
	knowledgeURL := ""
	if state.knowledge.State == domain.KnowledgeStatePresent && len(state.knowledge.Entries) == 0 {
		knowledgeURL = resourceURL("files/knowledge/" + state.knowledge.SHA256)
	}
	document := remoteChannelDocument{Protocol: "wharness.remote-channel/v2", RootRequestID: state.rootRequestID, ActiveRequestID: state.activeRequest, Generation: state.generation, ContextSHA256: item.Context.Manifest.SHA256, Prompt: resourceURL("prompt.md"), FileMap: resourceURL("file-map.json"), DiffCheck: resourceURL("diff-check.json"), Hash: resourceURL("hash.txt"), Events: resourceURL("events"), BundleContract: resourceURL("bundle-contract.json"), Status: "active", UpdatedAt: time.Now().UTC().Format(time.RFC3339Nano), FinalCheckMessage: remoteFinalDiffCheckInstruction, Knowledge: knowledgeURL, KnowledgeState: state.knowledge.State, KnowledgeVersion: state.knowledge.Version, KnowledgeRevision: state.knowledge.Revision, KnowledgeSHA256: state.knowledge.SHA256}
	if err := writeRemoteChannelJSON(statePath, document); err != nil {
		return nil, err
	}
	state.fileMapEntries = entries
	resources = append(resources,
		RemoteInputChannelResource{Path: "hash.txt", FilePath: hashPath, ContentType: "text/plain; charset=utf-8"},
		RemoteInputChannelResource{Path: "file-map.json", FilePath: mapPath, ContentType: "application/json"},
		RemoteInputChannelResource{Path: "diff-check.json", FilePath: diffCheckPath, ContentType: "application/json"},
		RemoteInputChannelResource{Path: "state.json", FilePath: statePath, ContentType: "application/json"},
	)
	return resources, nil
}

func (s *Service) closeSupersededRemoteInputChannel(sessionID, newRootRequestID string) {
	s.remoteLeaseMu.Lock()
	current := s.remoteChannels[sessionID]
	s.remoteLeaseMu.Unlock()
	if current != nil && current.rootRequestID != newRootRequestID {
		s.closeRemoteInputChannel(sessionID, "request.superseded")
	}
}

func (s *Service) closeRemoteInputChannel(sessionID, reason string) {
	store, ok := s.remoteInputs.(RemoteInputChannelStore)
	if !ok {
		return
	}
	s.remoteLeaseMu.Lock()
	current := s.remoteChannels[sessionID]
	if current != nil {
		delete(s.remoteChannels, sessionID)
	}
	s.remoteLeaseMu.Unlock()
	if current == nil {
		return
	}
	if current.cancel != nil {
		current.cancel()
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := closeRemoteChannelSet(ctx, store, current.publications, current.channelID); err != nil {
		s.bus.Publish(sessionID, "remote_channel.close_failed", map[string]any{"error": err.Error(), "reason": reason})
		return
	}
	s.bus.Publish(sessionID, "remote_channel.closed", map[string]any{"reason": reason, "root_request_id": current.rootRequestID})
}

func remoteChannelResourcePath(dir, relative string) string {
	return filepath.Join(dir, filepath.FromSlash(relative))
}
