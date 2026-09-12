package app

import (
	"archive/zip"
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"kernl.local/harness/backend/internal/audit"
	"kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/planner/manual"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/sandbox"
	"kernl.local/harness/backend/internal/session"
)

type capturingRemoteStore struct {
	mu         sync.Mutex
	objectName string
	entries    map[string]bool
	context    map[string]string
	objects    []string
	retained   []string
	released   []string
}

type capturedChannelUpdate struct {
	event string
	paths []string
}

type capturingChannelStore struct {
	capturingRemoteStore
	channels int
	channel  string
	root     string
	paths    map[string][]byte
	events   []string
	updates  []capturedChannelUpdate
	closed   []string
}

func (s *capturingChannelStore) SupportsRemoteInputChannels() bool { return true }

func (s *capturingChannelStore) PublishRemoteInputChannel(_ context.Context, channel RemoteInputChannel) (RemoteInputPublication, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.channels++
	s.channel = channel.ChannelID
	s.root = channel.RootRequest
	s.paths = make(map[string][]byte)
	if err := s.captureChannelResources(channel.Resources); err != nil {
		return RemoteInputPublication{}, err
	}
	return RemoteInputPublication{Provider: "trycloudflare", InstanceID: "tunnel-1", URL: "https://unit-test.trycloudflare.com/" + channel.ChannelID + "/manifest.json"}, nil
}

func (s *capturingChannelStore) UpdateRemoteInputChannel(_ context.Context, _ string, update RemoteInputChannelUpdate) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	paths := make([]string, 0, len(update.Resources))
	for _, resource := range update.Resources {
		paths = append(paths, resource.Path)
	}
	s.events = append(s.events, update.Event)
	s.updates = append(s.updates, capturedChannelUpdate{event: update.Event, paths: paths})
	return s.captureChannelResources(update.Resources)
}

func (s *capturingChannelStore) CloseRemoteInputChannel(_ context.Context, _, channelID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.closed = append(s.closed, channelID)
	return nil
}

func (s *capturingChannelStore) captureChannelResources(resources []RemoteInputChannelResource) error {
	if s.paths == nil {
		s.paths = make(map[string][]byte)
	}
	for _, resource := range resources {
		var raw []byte
		var err error
		if resource.ArchivePath != "" {
			raw, err = readRemoteChannelArchiveEntry(resource.ArchivePath, resource.ArchiveEntry)
		} else {
			raw, err = os.ReadFile(resource.FilePath)
		}
		if err != nil {
			return err
		}
		s.paths[resource.Path] = raw
	}
	return nil
}

func readRemoteChannelArchiveEntry(archivePath, entryName string) ([]byte, error) {
	archive, err := zip.OpenReader(archivePath)
	if err != nil {
		return nil, err
	}
	defer archive.Close()
	for _, entry := range archive.File {
		if entry.Name != entryName {
			continue
		}
		input, err := entry.Open()
		if err != nil {
			return nil, err
		}
		defer input.Close()
		return io.ReadAll(input)
	}
	return nil, os.ErrNotExist
}

func countRemoteResourcePaths(paths []string, prefix string) int {
	count := 0
	for _, path := range paths {
		if strings.HasPrefix(path, prefix) {
			count++
		}
	}
	return count
}

func latestCapturedUpdate(updates []capturedChannelUpdate, event string) (capturedChannelUpdate, bool) {
	for index := len(updates) - 1; index >= 0; index-- {
		if updates[index].event == event {
			return updates[index], true
		}
	}
	return capturedChannelUpdate{}, false
}

func (s *capturingRemoteStore) RetainRemoteInput(instanceID, objectName string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.retained = append(s.retained, instanceID+":"+objectName)
	return nil
}

func (s *capturingRemoteStore) ReleaseRemoteInput(instanceID, objectName string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.released = append(s.released, instanceID+":"+objectName)
	return nil
}

func (s *capturingRemoteStore) Status() RemoteInputStatus {
	return RemoteInputStatus{Enabled: true, Provider: "capture", Mode: "remote_url"}
}

func (s *capturingRemoteStore) Publish(_ context.Context, object RemoteInputObject) (RemoteInputPublication, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.objectName = object.ObjectName
	s.objects = append(s.objects, object.ObjectName)
	s.entries = map[string]bool{}
	s.context = map[string]string{}
	archive, err := zip.OpenReader(object.FilePath)
	if err != nil {
		return RemoteInputPublication{}, err
	}
	defer archive.Close()
	for _, entry := range archive.File {
		s.entries[entry.Name] = true
		if !strings.HasPrefix(entry.Name, "context/") || entry.FileInfo().IsDir() {
			continue
		}
		input, readErr := entry.Open()
		if readErr != nil {
			return RemoteInputPublication{}, readErr
		}
		raw, readErr := io.ReadAll(input)
		_ = input.Close()
		if readErr != nil {
			return RemoteInputPublication{}, readErr
		}
		s.context[strings.TrimPrefix(entry.Name, "context/")] = string(raw)
	}
	return RemoteInputPublication{Provider: "capture", InstanceID: "capture-1", URL: "https://files.example/" + object.ObjectName}, nil
}

func (s *capturingRemoteStore) contextFile(path string) string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.context[path]
}

func (s *capturingRemoteStore) snapshot() (string, map[string]bool, []string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	entries := make(map[string]bool, len(s.entries))
	for name, included := range s.entries {
		entries[name] = included
	}
	return s.objectName, entries, append([]string(nil), s.objects...)
}

func TestBuildRemoteInputArchiveContainsPromptContextAndAttachments(t *testing.T) {
	root := t.TempDir()
	contextPath := filepath.Join(root, "context.zip")
	contextFile, err := os.Create(contextPath)
	if err != nil {
		t.Fatal(err)
	}
	contextZip := zip.NewWriter(contextFile)
	if err = writeZipBytes(contextZip, "src/main.txt", []byte("context")); err != nil {
		t.Fatal(err)
	}
	if err = contextZip.Close(); err != nil {
		t.Fatal(err)
	}
	if err = contextFile.Close(); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(root, "remote.zip")
	request := RemoteInputRequest{RequestID: "req_test", Prompt: "full prompt", IncludeContext: true}
	attachments, err := decodeRemoteFiles([]RemoteInputFile{{Name: "notes.txt", ContentBase64: base64.StdEncoding.EncodeToString([]byte("notes"))}}, maxRemoteAttachmentBytes)
	if err != nil {
		t.Fatal(err)
	}
	digest, size, err := buildRemoteInputArchive(target, contextPath, request, domain.RequestKnowledgeSnapshot{State: domain.KnowledgeStateNone}, nil, attachments, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(digest) != 64 || size <= 0 {
		t.Fatalf("invalid digest/size: %q %d", digest, size)
	}
	archive, err := zip.OpenReader(target)
	if err != nil {
		t.Fatal(err)
	}
	defer archive.Close()
	names := map[string]bool{}
	for _, entry := range archive.File {
		names[entry.Name] = true
	}
	for _, expected := range []string{"transport.json", "prompt/wharness-planner-prompt.md", "context/src/main.txt", "attachments/notes.txt"} {
		if !names[expected] {
			t.Errorf("missing %s", expected)
		}
	}
}

func TestPublishRemoteInputRequiresActiveRequestAndReturnsShortBootstrap(t *testing.T) {
	project := t.TempDir()
	if err := os.WriteFile(filepath.Join(project, "main.txt"), []byte("hello"), 0o600); err != nil {
		t.Fatal(err)
	}
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 2<<20), manual.New(), policy.NewEngine(), sandbox.NewLocalRunner())
	remote := &capturingRemoteStore{}
	service.SetRemoteInputStore(remote)
	started, err := service.StartSession(context.Background(), project)
	if err != nil {
		t.Fatal(err)
	}
	_, prompted, err := service.SubmitMessage(context.Background(), started.ID, "implement it")
	if err != nil {
		t.Fatal(err)
	}
	result, err := service.PublishRemoteInput(context.Background(), started.ID, RemoteInputRequest{
		RequestID: prompted.LastRequestID, Prompt: prompted.LastManualPrompt, IncludeContext: true,
		Attachments: []RemoteInputFile{{Name: "request.txt", ContentBase64: base64.StdEncoding.EncodeToString([]byte("attached"))}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Mode != "remote_url" || result.InstanceID != "capture-1" || !strings.Contains(result.BootstrapPrompt, "https://files.example/") || strings.Contains(result.BootstrapPrompt, prompted.LastManualPrompt) {
		t.Fatalf("unexpected bootstrap: %#v", result)
	}
	if !strings.Contains(result.BootstrapPrompt, "ZIP:") || !strings.Contains(result.BootstrapPrompt, "Download the raw ZIP") || !strings.Contains(result.BootstrapPrompt, "prompt/wharness-planner-prompt.md") {
		t.Fatalf("bootstrap does not identify the ZIP contract: %q", result.BootstrapPrompt)
	}
	objectName, entries, _ := remote.snapshot()
	if !strings.HasPrefix(objectName, "whx_bundle_req_system_"+prompted.LastRequestID+"-") || !entries["prompt/wharness-planner-prompt.md"] || !entries["context/main.txt"] {
		t.Fatalf("unexpected remote archive: object=%q entries=%#v", objectName, entries)
	}
	if _, err := service.PublishRemoteInput(context.Background(), started.ID, RemoteInputRequest{RequestID: "req_wrong", Prompt: "prompt"}); err == nil {
		t.Fatal("expected inactive request id to be rejected")
	}
}

func TestRemoteInputPublishesFreshRequestArchiveInsteadOfSharedContext(t *testing.T) {
	project := t.TempDir()
	if err := os.WriteFile(filepath.Join(project, "main.txt"), []byte("hello"), 0o600); err != nil {
		t.Fatal(err)
	}
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 2<<20), manual.New(), policy.NewEngine(), sandbox.NewLocalRunner())
	remote := &capturingRemoteStore{}
	service.SetRemoteInputStore(remote)
	started, err := service.StartSession(context.Background(), project)
	if err != nil {
		t.Fatal(err)
	}
	_, prompted, err := service.SubmitMessage(context.Background(), started.ID, "explain it")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(project, "main.txt"), []byte("edited while preparing remote input"), 0o600); err != nil {
		t.Fatal(err)
	}
	first, err := service.PublishRemoteInput(context.Background(), started.ID, RemoteInputRequest{RequestID: prompted.LastRequestID, Prompt: prompted.LastManualPrompt, BootstrapText: "PEDIDO CURTO DO COMPOSITOR"})
	if err != nil {
		t.Fatal(err)
	}
	objectName, entries, objects := remote.snapshot()
	if len(objects) != 1 || !strings.HasPrefix(objectName, "whx_bundle_req_system_"+prompted.LastRequestID+"-") || !entries["context/main.txt"] || !entries["prompt/wharness-planner-prompt.md"] {
		t.Fatalf("request must publish a fresh archive with context and prompt: objects=%#v entries=%#v", objects, entries)
	}
	if !strings.Contains(first.BootstrapPrompt, "WHARNEX INPUT") || strings.Contains(first.BootstrapPrompt, prompted.LastManualPrompt) || !first.IncludedContext {
		t.Fatalf("request bootstrap is invalid: %#v", first)
	}
	if got := remote.contextFile("main.txt"); got != "edited while preparing remote input" {
		t.Fatalf("published context was stale: %q", got)
	}
}

func TestRemoteInputLeaseIsReleasedOnlyAfterTerminalBundle(t *testing.T) {
	project := t.TempDir()
	if err := os.WriteFile(filepath.Join(project, "main.txt"), []byte("hello"), 0o600); err != nil {
		t.Fatal(err)
	}
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 2<<20), manual.New(), policy.NewEngine(), sandbox.NewLocalRunner())
	remote := &capturingRemoteStore{}
	service.SetRemoteInputStore(remote)
	started, err := service.StartSession(context.Background(), project)
	if err != nil {
		t.Fatal(err)
	}
	_, prompted, err := service.SubmitMessage(context.Background(), started.ID, "explain it")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.PublishRemoteInput(context.Background(), started.ID, RemoteInputRequest{RequestID: prompted.LastRequestID, Prompt: prompted.LastManualPrompt}); err != nil {
		t.Fatal(err)
	}
	remote.mu.Lock()
	retained, released := append([]string(nil), remote.retained...), append([]string(nil), remote.released...)
	remote.mu.Unlock()
	if len(retained) != 1 || len(released) != 0 {
		t.Fatalf("lease must remain active before bundle completion: retained=%#v released=%#v", retained, released)
	}
	if _, err := service.SubmitExecutionBundle(context.Background(), started.ID, "whx_bundle_res_system_"+prompted.LastRequestID+".zip", makeAnswerBundle(t, prompted.LastRequestID)); err != nil {
		t.Fatal(err)
	}
	remote.mu.Lock()
	released = append([]string(nil), remote.released...)
	remote.mu.Unlock()
	if len(released) != 1 || released[0] != retained[0] {
		t.Fatalf("terminal bundle must release exactly its lease: retained=%#v released=%#v", retained, released)
	}
}

func TestRemoteInputChannelReusesMainRequestNamespaceAndRefreshesContext(t *testing.T) {
	project := t.TempDir()
	if err := os.WriteFile(filepath.Join(project, "main.txt"), []byte("first"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(project, "stable.txt"), []byte("stable"), 0o600); err != nil {
		t.Fatal(err)
	}
	store := session.NewStore()
	service := NewService(store, audit.NewBus(), contextbundle.NewBuilder(1<<20, 2<<20), manual.New(), policy.NewEngine(), sandbox.NewLocalRunner())
	remote := &capturingChannelStore{}
	service.SetRemoteInputStore(remote)
	started, err := service.StartSession(context.Background(), project)
	if err != nil {
		t.Fatal(err)
	}
	_, prompted, err := service.SubmitMessage(context.Background(), started.ID, "inspect")
	if err != nil {
		t.Fatal(err)
	}
	result, err := service.PublishRemoteInput(context.Background(), started.ID, RemoteInputRequest{RequestID: prompted.LastRequestID, Prompt: prompted.LastManualPrompt, ProjectFiles: []string{"main.txt"}})
	if err != nil {
		t.Fatal(err)
	}
	if result.Mode != "tunnel" || !strings.Contains(result.BootstrapPrompt, "/manifest.json") {
		t.Fatalf("unexpected channel result: %#v", result)
	}
	remote.mu.Lock()
	channelID := remote.channel
	initialRoot := remote.root
	_, hasManifest := remote.paths["manifest.json"]
	_, hasState := remote.paths["state.json"]
	_, hasDiffCheck := remote.paths["diff-check.json"]
	_, hasPrompt := remote.paths["prompts/"+prompted.LastRequestID+".md"]
	stateRaw := append([]byte(nil), remote.paths["state.json"]...)
	fileMapRaw := append([]byte(nil), remote.paths["file-map.json"]...)
	diffCheckRaw := append([]byte(nil), remote.paths["diff-check.json"]...)
	initialContextResources := 0
	for path := range remote.paths {
		if strings.HasPrefix(path, "files/context/") {
			initialContextResources++
		}
	}
	requestReady, hasRequestReady := latestCapturedUpdate(remote.updates, "request.ready")
	remote.mu.Unlock()
	if !hasManifest || !hasState || !hasPrompt || !hasDiffCheck {
		t.Fatalf("channel resources missing: manifest=%t state=%t prompt=%t diff_check=%t", hasManifest, hasState, hasPrompt, hasDiffCheck)
	}
	if initialContextResources == 0 {
		t.Fatal("initial channel publication did not install context resources")
	}
	if !hasRequestReady || countRemoteResourcePaths(requestReady.paths, "files/context/") != 0 {
		t.Fatalf("request.ready recopied already installed context resources: %#v", requestReady.paths)
	}
	baseURL := "https://unit-test.trycloudflare.com/" + channelID
	if !strings.Contains(result.BootstrapPrompt, "STATUS: https://unit-test.trycloudflare.com/status") || !strings.Contains(result.BootstrapPrompt, "First fetch STATUS") {
		t.Fatalf("bootstrap does not require the public tunnel status: %s", result.BootstrapPrompt)
	}
	for _, absolute := range []string{baseURL + "/state.json", baseURL + "/prompt.md", baseURL + "/file-map.json", baseURL + "/hash.txt", baseURL + "/diff-check.json", baseURL + "/bundle-contract.json"} {
		if !strings.Contains(result.BootstrapPrompt, absolute) {
			t.Fatalf("bootstrap does not pre-authorize %s: %s", absolute, result.BootstrapPrompt)
		}
	}
	var state remoteChannelDocument
	if err := json.Unmarshal(stateRaw, &state); err != nil {
		t.Fatal(err)
	}
	if state.FileMap != baseURL+"/file-map.json" || state.Prompt != baseURL+"/prompt.md" {
		t.Fatalf("state does not contain absolute file-map resources: %#v", state)
	}
	if state.DiffCheck != baseURL+"/diff-check.json" || !strings.Contains(state.FinalCheckMessage, "actual patch paths") {
		t.Fatalf("state does not require a final diff compatibility check: %#v", state)
	}
	if !strings.Contains(result.FallbackPrompt, "MUST perform a final diff compatibility check") || !strings.Contains(result.FallbackPrompt, "try the next tunnel") {
		t.Fatalf("ZIP+tunnel fallback does not require ordered final verification: %s", result.FallbackPrompt)
	}
	if !strings.Contains(result.BootstrapPrompt, "SSE/events are optional telemetry") || !strings.Contains(result.BootstrapPrompt, "completed, failed, or partial") {
		t.Fatalf("tunnel-only bootstrap does not make optional streaming and outcome values explicit: %s", result.BootstrapPrompt)
	}
	var fileMap remoteFileMapDocument
	if err := json.Unmarshal(fileMapRaw, &fileMap); err != nil {
		t.Fatal(err)
	}
	if fileMap.Protocol != "wharness.remote-file-map/v1" {
		t.Fatalf("unexpected map protocol: %#v", fileMap)
	}
	var diffCheck remoteDiffCheckDocument
	if err := json.Unmarshal(diffCheckRaw, &diffCheck); err != nil {
		t.Fatal(err)
	}
	if diffCheck.Protocol != "wharness.remote-diff-check/v1" || diffCheck.ContextSHA256 != prompted.Context.Manifest.SHA256 || len(diffCheck.Rules) != 3 {
		t.Fatalf("unexpected initial diff check: %#v", diffCheck)
	}
	foundProjectFile := false
	stableResourcePath := ""
	for _, entry := range fileMap.Files {
		if entry.Path == "main.txt" && entry.Role == "context" && entry.Selected && strings.HasPrefix(entry.URL, baseURL+"/files/context/") {
			foundProjectFile = true
		}
		if entry.Path == "stable.txt" && entry.Role == "context" && strings.HasPrefix(entry.URL, baseURL+"/files/context/") {
			stableResourcePath = strings.TrimPrefix(entry.URL, baseURL+"/")
		}
	}
	if !foundProjectFile {
		t.Fatal("selected @file is missing its individually authorized map entry")
	}
	if stableResourcePath == "" {
		t.Fatal("stable context file is missing from the initial file map")
	}
	beforeUnchangedRefresh, err := store.Get(started.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := service.refreshRemoteInputChannelContext(context.Background(), started.ID, channelID); err != nil {
		t.Fatal(err)
	}
	afterUnchangedRefresh, err := store.Get(started.ID)
	if err != nil {
		t.Fatal(err)
	}
	if afterUnchangedRefresh.Context.ID != beforeUnchangedRefresh.Context.ID {
		t.Fatalf("unchanged remote monitor rebuilt the full context: before=%q after=%q", beforeUnchangedRefresh.Context.ID, afterUnchangedRefresh.Context.ID)
	}
	if err := os.WriteFile(filepath.Join(project, "main.txt"), []byte("second"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := service.refreshRemoteInputChannelContext(context.Background(), started.ID, channelID); err != nil {
		t.Fatal(err)
	}
	remote.mu.Lock()
	refreshedDiffCheckRaw := append([]byte(nil), remote.paths["diff-check.json"]...)
	contextChanged, hasContextChanged := latestCapturedUpdate(remote.updates, "context.changed")
	remote.mu.Unlock()
	var refreshedDiffCheck remoteDiffCheckDocument
	if err := json.Unmarshal(refreshedDiffCheckRaw, &refreshedDiffCheck); err != nil {
		t.Fatal(err)
	}
	if refreshedDiffCheck.Generation <= diffCheck.Generation || refreshedDiffCheck.ContextSHA256 == diffCheck.ContextSHA256 {
		t.Fatalf("context refresh did not advance the final diff check: before=%#v after=%#v", diffCheck, refreshedDiffCheck)
	}
	changedContextResources := countRemoteResourcePaths(contextChanged.paths, "files/context/")
	if !hasContextChanged || changedContextResources == 0 {
		t.Fatalf("context.changed did not publish changed context content: paths=%#v", contextChanged.paths)
	}
	if containsString(contextChanged.paths, stableResourcePath) {
		t.Fatalf("context.changed recopied an unchanged content-addressed resource %q: %#v", stableResourcePath, contextChanged.paths)
	}
	childRequest := "req_20260906T200000_aaaaaaaaaaaaaaaa"
	if _, err := store.Update(started.ID, func(item *domain.Session) error {
		item.LastRequestID = childRequest
		item.LastManualPrompt = "continue with refreshed context"
		item.PendingManualRequestIDs = []string{childRequest}
		recordRequestKnowledge(item, childRequest, domain.RequestKnowledgeSnapshot{State: domain.KnowledgeStateNone})
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := service.PublishRemoteInput(context.Background(), started.ID, RemoteInputRequest{RequestID: childRequest, Prompt: "continue with refreshed context"}); err != nil {
		t.Fatal(err)
	}
	remote.mu.Lock()
	promptChanged, hasPromptChanged := latestCapturedUpdate(remote.updates, "prompt.changed")
	remote.mu.Unlock()
	if !hasPromptChanged || countRemoteResourcePaths(promptChanged.paths, "files/context/") != 0 {
		t.Fatalf("prompt-only channel update recopied unchanged context resources: %#v", promptChanged.paths)
	}
	if err := service.NotifyRemoteInputChannel(started.ID, childRequest, "consider this additional constraint"); err != nil {
		t.Fatal(err)
	}
	remote.mu.Lock()
	channels := remote.channels
	root := remote.root
	events := append([]string(nil), remote.events...)
	remote.mu.Unlock()
	if channels != 1 || root != initialRoot || !containsString(events, "context.changed") || !containsString(events, "prompt.changed") || !containsString(events, "comment.added") {
		t.Fatalf("main channel was not reused: channels=%d root=%q events=%#v", channels, root, events)
	}
	if _, err := service.SubmitExecutionBundle(context.Background(), started.ID, "whx_bundle_res_system_"+childRequest+".zip", makeAnswerBundle(t, childRequest)); err != nil {
		t.Fatal(err)
	}
	remote.mu.Lock()
	closed := append([]string(nil), remote.closed...)
	remote.mu.Unlock()
	if len(closed) != 1 || closed[0] != channelID {
		t.Fatalf("terminal bundle did not close the main channel: %#v", closed)
	}
}

func TestRemoteInputChannelRebuildsMissingContextAfterBackendRestart(t *testing.T) {
	project := t.TempDir()
	if err := os.WriteFile(filepath.Join(project, "main.txt"), []byte("current"), 0o600); err != nil {
		t.Fatal(err)
	}
	store := session.NewStore()
	service := NewService(store, audit.NewBus(), contextbundle.NewBuilder(1<<20, 2<<20), manual.New(), policy.NewEngine(), sandbox.NewLocalRunner())
	remote := &capturingChannelStore{}
	service.SetRemoteInputStore(remote)
	started, err := service.StartSession(context.Background(), project)
	if err != nil {
		t.Fatal(err)
	}
	_, prompted, err := service.SubmitMessage(context.Background(), started.ID, "inspect")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.RemoveAll(filepath.Dir(prompted.Context.ZipPath)); err != nil {
		t.Fatal(err)
	}

	result, err := service.PublishRemoteInput(context.Background(), started.ID, RemoteInputRequest{
		RequestID: prompted.LastRequestID,
		Prompt:    prompted.LastManualPrompt,
	})
	if err != nil {
		t.Fatalf("publish after lost process-local context: %v", err)
	}
	if result.Mode != "tunnel" {
		t.Fatalf("unexpected remote result: %#v", result)
	}
	rebuilt, err := store.Get(started.ID)
	if err != nil {
		t.Fatal(err)
	}
	if info, statErr := os.Stat(rebuilt.Context.ZipPath); statErr != nil || !info.Mode().IsRegular() {
		t.Fatalf("context archive was not rebuilt: path=%q err=%v", rebuilt.Context.ZipPath, statErr)
	}
}

func TestProjectFileReferenceForcesRequestArchiveAndMustBeEligible(t *testing.T) {
	project := t.TempDir()
	if err := os.WriteFile(filepath.Join(project, "main.txt"), []byte("hello"), 0o600); err != nil {
		t.Fatal(err)
	}
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 2<<20), manual.New(), policy.NewEngine(), sandbox.NewLocalRunner())
	remote := &capturingRemoteStore{}
	service.SetRemoteInputStore(remote)
	started, err := service.StartSession(context.Background(), project)
	if err != nil {
		t.Fatal(err)
	}
	_, prompted, err := service.SubmitMessage(context.Background(), started.ID, "inspect main")
	if err != nil {
		t.Fatal(err)
	}
	result, err := service.PublishRemoteInput(context.Background(), started.ID, RemoteInputRequest{RequestID: prompted.LastRequestID, Prompt: prompted.LastManualPrompt, ProjectFiles: []string{"main.txt"}})
	if err != nil {
		t.Fatal(err)
	}
	objectName, entries, objects := remote.snapshot()
	if len(objects) != 1 || !strings.HasPrefix(objectName, "whx_bundle_req_system_") || !entries["references/project-files.json"] {
		t.Fatalf("reference did not produce an enriched request archive: objects=%#v entries=%#v result=%#v", objects, entries, result)
	}
	if _, err := service.PublishRemoteInput(context.Background(), started.ID, RemoteInputRequest{RequestID: prompted.LastRequestID, Prompt: prompted.LastManualPrompt, ProjectFiles: []string{".git/config"}}); err == nil {
		t.Fatal("expected excluded project reference to be rejected")
	}
}

func TestRemoteInputFailureEndsPendingRequestAndClosesChannel(t *testing.T) {
	project := t.TempDir()
	if err := os.WriteFile(filepath.Join(project, "main.txt"), []byte("first"), 0o600); err != nil {
		t.Fatal(err)
	}
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 2<<20), manual.New(), policy.NewEngine(), sandbox.NewLocalRunner())
	remote := &capturingChannelStore{}
	service.SetRemoteInputStore(remote)
	started, err := service.StartSession(context.Background(), project)
	if err != nil {
		t.Fatal(err)
	}
	_, prompted, err := service.SubmitMessage(context.Background(), started.ID, "inspect")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.PublishRemoteInput(context.Background(), started.ID, RemoteInputRequest{RequestID: prompted.LastRequestID, Prompt: prompted.LastManualPrompt}); err != nil {
		t.Fatal(err)
	}
	updated, err := service.FailRemoteInputRequest(context.Background(), started.ID, prompted.LastRequestID, "bundle download timed out")
	if err != nil {
		t.Fatal(err)
	}
	if updated.State != "failed" || updated.FailureKind != domain.FailureKindRemoteInputTransport || containsString(updated.PendingManualRequestIDs, prompted.LastRequestID) || !strings.Contains(updated.LastRepairError, "bundle download timed out") {
		t.Fatalf("remote failure left the request active: %#v", updated)
	}
	remote.mu.Lock()
	closed := append([]string(nil), remote.closed...)
	remote.mu.Unlock()
	if len(closed) != 1 {
		t.Fatalf("remote failure did not close the active channel: %#v", closed)
	}
}

func TestRetryFailedRequestCreatesFreshDurableRequestWithoutFrontendTranscript(t *testing.T) {
	project := t.TempDir()
	if err := os.WriteFile(filepath.Join(project, "main.txt"), []byte("first"), 0o600); err != nil {
		t.Fatal(err)
	}
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 2<<20), manual.New(), policy.NewEngine(), sandbox.NewLocalRunner())
	started, err := service.StartSession(context.Background(), project)
	if err != nil {
		t.Fatal(err)
	}
	_, prompted, err := service.SubmitMessage(context.Background(), started.ID, "original task")
	if err != nil {
		t.Fatal(err)
	}
	failed, err := service.FailRemoteInputRequest(context.Background(), started.ID, prompted.LastRequestID, "stale command plan cannot be reconciled without its immutable request base")
	if err != nil {
		t.Fatal(err)
	}
	retried, err := service.RetryFailedRequest(context.Background(), started.ID)
	if err != nil {
		t.Fatal(err)
	}
	if retried.State != "awaiting_plan" || retried.LastRequestID == failed.LastRequestID || !containsString(retried.PendingManualRequestIDs, retried.LastRequestID) {
		t.Fatalf("failed request was not recreated with a fresh identity: %#v", retried)
	}
	if retried.RequestBaselines[retried.LastRequestID] == "" || retried.RequestContextArchives[retried.LastRequestID] == "" {
		t.Fatalf("fresh retry lacks immutable request base: baselines=%#v archives=%#v", retried.RequestBaselines, retried.RequestContextArchives)
	}
	if !strings.Contains(retried.LastManualPrompt, "FRESH REQUEST RECOVERY") ||
		!strings.Contains(retried.LastManualPrompt, "PREVIOUS TERMINAL FAILURE — AUTHORITATIVE EVIDENCE") ||
		!strings.Contains(retried.LastManualPrompt, "stale command plan cannot be reconciled without its immutable request base") ||
		!strings.Contains(retried.LastManualPrompt, "Do not repeat a semantically equivalent plan") ||
		!strings.Contains(retried.LastManualPrompt, "retryable=false") {
		t.Fatalf("fresh recovery prompt lost failure evidence or anti-repeat rules: %s", retried.LastManualPrompt)
	}
	lineage := retried.RequestLineages[retried.LastRequestID]
	if lineage.ParentRequestID != failed.LastRequestID || lineage.RootRequestID != prompted.LastRequestID || lineage.Kind != requestKindRepair {
		t.Fatalf("fresh recovery lost request lineage: %#v", lineage)
	}
}

func TestAutoModeProtocolBundleFailurePreparesExactlyOneFreshRequest(t *testing.T) {
	project := t.TempDir()
	if err := os.WriteFile(filepath.Join(project, "main.txt"), []byte("first"), 0o600); err != nil {
		t.Fatal(err)
	}
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 2<<20), manual.New(), policy.NewEngine(), sandbox.NewLocalRunner())
	started, err := service.StartSession(context.Background(), project)
	if err != nil {
		t.Fatal(err)
	}
	_, prompted, err := service.SubmitMessage(context.Background(), started.ID, "original task")
	if err != nil {
		t.Fatal(err)
	}
	recovered, err := service.FailRemoteInputRequestWithKind(context.Background(), started.ID, prompted.LastRequestID, "stale command plan cannot be reconciled without its immutable request base; submit one fresh request", "bundle_validation")
	if err != nil {
		t.Fatal(err)
	}
	if recovered.State != "awaiting_plan" || recovered.LastRequestID == prompted.LastRequestID || len(recovered.PendingManualRequestIDs) != 1 {
		t.Fatalf("Auto did not prepare one fresh request: %#v", recovered)
	}
	if recovered.RemoteRecoveryAttempt != 1 || recovered.RequestContextArchives[recovered.LastRequestID] == "" {
		t.Fatalf("fresh Auto recovery is not bounded/durable: %#v", recovered)
	}
}

func TestAutoModeSubmoduleWriteFailureIsTerminalWithoutFreshRequest(t *testing.T) {
	project := t.TempDir()
	if err := os.WriteFile(filepath.Join(project, "main.txt"), []byte("first"), 0o600); err != nil {
		t.Fatal(err)
	}
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 2<<20), manual.New(), policy.NewEngine(), sandbox.NewLocalRunner())
	started, err := service.StartSession(context.Background(), project)
	if err != nil {
		t.Fatal(err)
	}
	_, prompted, err := service.SubmitMessage(context.Background(), started.ID, "original task")
	if err != nil {
		t.Fatal(err)
	}

	reason := ErrSubmoduleWrite.Error() + ": services/admin/client/public/includes/cancelled-rides.html belongs to services/admin"
	failed, err := service.FailRemoteInputRequestWithKind(context.Background(), started.ID, prompted.LastRequestID, reason, "submodule_write")
	if err != nil {
		t.Fatal(err)
	}

	if failed.State != "failed" || failed.LastRequestID != prompted.LastRequestID {
		t.Fatalf("submodule refusal unexpectedly prepared another request: %#v", failed)
	}
	if failed.RemoteRecoveryAttempt != 0 || len(failed.PendingManualRequestIDs) != 0 {
		t.Fatalf("submodule refusal consumed a remote recovery attempt: %#v", failed)
	}
	if failed.FailureKind != domain.FailureKindSubmoduleWrite || failed.LastRepairError != reason {
		t.Fatalf("submodule refusal lost its typed repository diagnosis: %#v", failed)
	}
}

func TestRemoteInputFailureRejectsAHistoricalRequestThatIsNoLongerPending(t *testing.T) {
	project := t.TempDir()
	if err := os.WriteFile(filepath.Join(project, "main.txt"), []byte("first"), 0o600); err != nil {
		t.Fatal(err)
	}
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 2<<20), manual.New(), policy.NewEngine(), sandbox.NewLocalRunner())
	started, err := service.StartSession(context.Background(), project)
	if err != nil {
		t.Fatal(err)
	}
	_, prompted, err := service.SubmitMessage(context.Background(), started.ID, "inspect")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.store.Update(started.ID, func(current *domain.Session) error { current.PendingManualRequestIDs = nil; return nil }); err != nil {
		t.Fatal(err)
	}
	if _, err := service.FailRemoteInputRequest(context.Background(), started.ID, prompted.LastRequestID, "late transport failure"); err == nil {
		t.Fatal("accepted a historical request after its pending marker was removed")
	}
	if _, err := service.FailRemoteInputRequest(context.Background(), started.ID, "req_other", "must fail"); err == nil {
		t.Fatal("accepted a non-current restored request")
	}
}

func TestRemoteFileMapKeepsContextFilesSnapshotBackedUntilFetched(t *testing.T) {
	project := t.TempDir()
	if err := os.WriteFile(filepath.Join(project, "main.txt"), []byte("hello"), 0o600); err != nil {
		t.Fatal(err)
	}
	bundle, err := contextbundle.NewBuilder(1<<20, 2<<20).Build(project)
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(filepath.Dir(bundle.ZipPath))
	dir := t.TempDir()
	resources, entries, err := buildRemoteFileMapResources(dir, bundle.ZipPath, bundle.Manifest, domain.RequestKnowledgeSnapshot{State: domain.KnowledgeStateNone}, nil, nil, nil, nil, nil, func(path string) string { return "https://example.invalid/" + path })
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) == 0 {
		t.Fatal("context file map is empty")
	}
	found := false
	for _, resource := range resources {
		if !strings.HasPrefix(resource.Path, "files/context/") {
			continue
		}
		found = true
		if resource.FilePath != "" || resource.ArchivePath != bundle.ZipPath || resource.ArchiveEntry == "" || resource.ArchiveID != bundle.Manifest.SHA256 {
			t.Fatalf("context resource was eagerly materialized: %#v", resource)
		}
		if _, err := os.Stat(remoteChannelResourcePath(dir, resource.Path)); !os.IsNotExist(err) {
			t.Fatalf("context resource exists as an eager extracted file: %v", err)
		}
	}
	if !found {
		t.Fatal("no snapshot-backed context resource was produced")
	}
}
