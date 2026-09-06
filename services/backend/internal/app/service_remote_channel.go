package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/bundlename"
	"kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/domain"
)

const (
	remoteChannelRefreshInterval     = 2 * time.Second
	remoteChannelFullRefreshInterval = 30 * time.Second
)

type remoteInputChannelState struct {
	channelID      string
	instanceID     string
	provider       string
	manifestURL    string
	publications   []RemoteInputPublication
	baseURL        string
	manifestDigest string
	rootRequestID  string
	activeRequest  string
	generation     int64
	contextSHA256  string
	contextProbe   string
	contextChecked time.Time
	promptResource string
	fileMapEntries []remoteFileMapEntry
	cancel         context.CancelFunc
}

type remoteChannelDocument struct {
	Protocol          string `json:"protocol"`
	RootRequestID     string `json:"root_request_id"`
	ActiveRequestID   string `json:"active_request_id"`
	Generation        int64  `json:"generation"`
	ContextSHA256     string `json:"context_sha256"`
	Prompt            string `json:"prompt"`
	FileMap           string `json:"file_map"`
	DiffCheck         string `json:"diff_check"`
	Hash              string `json:"hash"`
	Events            string `json:"events"`
	BundleContract    string `json:"bundle_contract"`
	Status            string `json:"status"`
	UpdatedAt         string `json:"updated_at"`
	FinalCheckMessage string `json:"final_check_instruction"`
}

type remoteDiffCheckDocument struct {
	Protocol        string   `json:"protocol"`
	ActiveRequestID string   `json:"active_request_id"`
	Generation      int64    `json:"generation"`
	ContextSHA256   string   `json:"context_sha256"`
	State           string   `json:"state"`
	FileMap         string   `json:"file_map"`
	Rules           []string `json:"rules"`
}

const remoteFinalDiffCheckInstruction = "Immediately before creating the bundle, fetch diff-check.json and its current state and file map. Compare local changes with the actual patch paths, re-check every patch against the current files, and use the current context_sha256 only when they remain compatible."

func remoteDiffCheck(state *remoteInputChannelState, resourceURL func(string) string) remoteDiffCheckDocument {
	return remoteDiffCheckDocument{
		Protocol:        "wharness.remote-diff-check/v1",
		ActiveRequestID: state.activeRequest,
		Generation:      state.generation,
		ContextSHA256:   state.contextSHA256,
		State:           resourceURL("state.json"),
		FileMap:         resourceURL("file-map.json"),
		Rules: []string{
			"Derive touched files from the actual --- and +++ patch headers, not only from forecast metadata.",
			"If generation or context_sha256 changed, fetch current versions of every touched file and re-check each complete patch against them.",
			"A disjoint context change may be accepted by updating base_context_sha256; any overlapping or unverifiable change requires adapting the patch first.",
		},
	}
}

func (s *Service) publishRemoteInputChannel(ctx context.Context, store RemoteInputChannelStore, item domain.Session, request RemoteInputRequest, attachments, artifacts []decodedRemoteFile) (RemoteInputResult, error) {
	temporaryDir, err := os.MkdirTemp("", "wharness-remote-channel-*")
	if err != nil {
		return RemoteInputResult{}, err
	}
	defer os.RemoveAll(temporaryDir)

	s.remoteLeaseMu.Lock()
	current := s.remoteChannels[item.ID]
	s.remoteLeaseMu.Unlock()
	if current == nil {
		return s.openRemoteInputChannel(ctx, store, temporaryDir, item, request, attachments, artifacts)
	}
	return s.updateRemoteInputChannel(ctx, store, temporaryDir, item, request, attachments, artifacts, current)
}

func (s *Service) openRemoteInputChannel(ctx context.Context, store RemoteInputChannelStore, dir string, item domain.Session, request RemoteInputRequest, attachments, artifacts []decodedRemoteFile) (RemoteInputResult, error) {
	channelID, err := randomToken()
	if err != nil {
		return RemoteInputResult{}, err
	}
	state := &remoteInputChannelState{channelID: channelID, rootRequestID: request.RequestID, activeRequest: request.RequestID, generation: 1, contextSHA256: item.Context.Manifest.SHA256, contextChecked: time.Now()}
	state.contextProbe, _ = contextbundle.SourceProbe(item.ProjectPath)
	resources, total, largest, err := buildRemoteChannelResources(dir, item, request, attachments, artifacts, state, true)
	if err != nil {
		return RemoteInputResult{}, err
	}
	publications, err := publishRemoteChannelSet(ctx, store, RemoteInputChannel{ChannelID: channelID, RootRequest: request.RequestID, Resources: resources, Bytes: total, FileCount: len(resources), MaxFileSize: largest})
	if err != nil {
		return RemoteInputResult{}, err
	}
	publication := publications[0]
	state.instanceID = publication.InstanceID
	state.provider = publication.Provider
	state.manifestURL = publication.URL
	state.baseURL = strings.TrimSuffix(publication.URL, "/manifest.json")
	state.publications = publications
	_, err = updateRemoteChannelResources(ctx, store, publications, dir, item, request, attachments, artifacts, state, true, "request.ready")
	if err != nil {
		_ = closeRemoteChannelSet(ctx, store, publications, channelID)
		return RemoteInputResult{}, err
	}
	monitorContext, cancel := context.WithCancel(context.Background())
	state.cancel = cancel
	s.remoteLeaseMu.Lock()
	s.remoteChannels[item.ID] = state
	s.remoteLeaseMu.Unlock()
	go s.monitorRemoteInputChannel(monitorContext, item.ID, channelID)
	return s.remoteChannelResult(sessionChatID(item), request.RequestID, publications, state, total, filepath.Join(dir, "manifest.json")), nil
}

func (s *Service) updateRemoteInputChannel(ctx context.Context, store RemoteInputChannelStore, dir string, item domain.Session, request RemoteInputRequest, attachments, artifacts []decodedRemoteFile, current *remoteInputChannelState) (RemoteInputResult, error) {
	next := *current
	next.activeRequest = request.RequestID
	next.contextSHA256 = item.Context.Manifest.SHA256
	next.contextProbe, _ = contextbundle.SourceProbe(item.ProjectPath)
	next.contextChecked = time.Now()
	next.generation++
	total, err := updateRemoteChannelResources(ctx, store, current.publications, dir, item, request, attachments, artifacts, &next, false, "prompt.changed")
	if err != nil {
		return RemoteInputResult{}, err
	}
	s.remoteLeaseMu.Lock()
	if active := s.remoteChannels[item.ID]; active != nil && active.channelID == current.channelID {
		active.activeRequest = next.activeRequest
		active.contextSHA256 = next.contextSHA256
		active.contextProbe = next.contextProbe
		active.contextChecked = next.contextChecked
		active.generation = next.generation
		active.promptResource = next.promptResource
		active.fileMapEntries = next.fileMapEntries
	}
	s.remoteLeaseMu.Unlock()
	return s.remoteChannelResult(sessionChatID(item), request.RequestID, current.publications, &next, total, filepath.Join(dir, "manifest.json")), nil
}

func updateRemoteChannelResources(ctx context.Context, store RemoteInputChannelStore, publications []RemoteInputPublication, dir string, item domain.Session, request RemoteInputRequest, attachments, artifacts []decodedRemoteFile, state *remoteInputChannelState, includeManifest bool, event string) (int64, error) {
	var total int64
	var primary *remoteInputChannelState
	previousEntries := append([]remoteFileMapEntry(nil), state.fileMapEntries...)
	for index, publication := range publications {
		endpoint := *state
		endpoint.fileMapEntries = previousEntries
		endpoint.instanceID = publication.InstanceID
		endpoint.provider = publication.Provider
		endpoint.manifestURL = publication.URL
		endpoint.baseURL = strings.TrimSuffix(publication.URL, "/manifest.json")
		resources, size, _, err := buildRemoteChannelResources(dir, item, request, attachments, artifacts, &endpoint, includeManifest)
		if err != nil {
			return 0, err
		}
		update := RemoteInputChannelUpdate{ChannelID: state.channelID, Resources: resources, Event: event, Data: map[string]string{"request_id": request.RequestID, "generation": strconv.FormatInt(state.generation, 10), "context_sha256": state.contextSHA256}}
		if err := store.UpdateRemoteInputChannel(ctx, publication.InstanceID, update); err != nil {
			return 0, err
		}
		if index == 0 {
			candidate := endpoint
			if includeManifest {
				if raw, readErr := os.ReadFile(filepath.Join(dir, "manifest.json")); readErr == nil {
					digest := sha256.Sum256(raw)
					candidate.manifestDigest = hex.EncodeToString(digest[:])
				}
			}
			primary = &candidate
			total = size
		}
	}
	if primary != nil {
		state.instanceID, state.provider, state.manifestURL, state.baseURL = primary.instanceID, primary.provider, primary.manifestURL, primary.baseURL
		state.promptResource, state.fileMapEntries = primary.promptResource, primary.fileMapEntries
		state.manifestDigest = primary.manifestDigest
	}
	return total, nil
}

func publishRemoteChannelSet(ctx context.Context, store RemoteInputChannelStore, channel RemoteInputChannel) ([]RemoteInputPublication, error) {
	if set, ok := store.(RemoteInputChannelSetStore); ok {
		return set.PublishRemoteInputChannelSet(ctx, channel)
	}
	publication, err := store.PublishRemoteInputChannel(ctx, channel)
	return []RemoteInputPublication{publication}, err
}

func updateRemoteChannelSet(ctx context.Context, store RemoteInputChannelStore, publications []RemoteInputPublication, update RemoteInputChannelUpdate) error {
	ids := publicationIDs(publications)
	if set, ok := store.(RemoteInputChannelSetStore); ok {
		return set.UpdateRemoteInputChannelSet(ctx, ids, update)
	}
	if len(ids) != 1 {
		return fmt.Errorf("remote channel publication set is unsupported")
	}
	return store.UpdateRemoteInputChannel(ctx, ids[0], update)
}

func closeRemoteChannelSet(ctx context.Context, store RemoteInputChannelStore, publications []RemoteInputPublication, channelID string) error {
	ids := publicationIDs(publications)
	if set, ok := store.(RemoteInputChannelSetStore); ok {
		return set.CloseRemoteInputChannelSet(ctx, ids, channelID)
	}
	if len(ids) != 1 {
		return fmt.Errorf("remote channel publication set is unsupported")
	}
	return store.CloseRemoteInputChannel(ctx, ids[0], channelID)
}

func publicationIDs(publications []RemoteInputPublication) []string {
	ids := make([]string, 0, len(publications))
	for _, publication := range publications {
		ids = append(ids, publication.InstanceID)
	}
	return ids
}

func buildRemoteChannelResources(dir string, item domain.Session, request RemoteInputRequest, attachments, artifacts []decodedRemoteFile, state *remoteInputChannelState, includeManifest bool) ([]RemoteInputChannelResource, int64, int64, error) {
	channelSubID := ""
	if request.RequestID != state.rootRequestID {
		channelSubID = request.RequestID
	}
	expectedFilename := bundlename.Build(bundlename.KindResponse, sessionChatID(item), state.rootRequestID, channelSubID)
	state.promptResource = "prompts/" + request.RequestID + ".md"
	resourceURL := func(path string) string {
		if state.baseURL == "" {
			return path
		}
		return strings.TrimSuffix(state.baseURL, "/") + "/" + path
	}
	resources, entries, err := buildRemoteFileMapResources(dir, item.Context.ZipPath, item.Context.Manifest, request.ProjectFiles, attachments, artifacts, state.fileMapEntries, resourceURL)
	if err != nil {
		return nil, 0, 0, err
	}
	state.fileMapEntries = entries
	write := func(resourcePath, contentType string, raw []byte) error {
		path := remoteChannelResourcePath(dir, resourcePath)
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			return err
		}
		if err := os.WriteFile(path, raw, 0o600); err != nil {
			return err
		}
		resources = append(resources, RemoteInputChannelResource{Path: resourcePath, FilePath: path, ContentType: contentType, Bytes: int64(len(raw))})
		return nil
	}
	if err := write(state.promptResource, "text/plain; charset=utf-8", []byte(request.Prompt)); err != nil {
		return nil, 0, 0, err
	}
	if err := write("prompt.md", "text/plain; charset=utf-8", []byte(request.Prompt)); err != nil {
		return nil, 0, 0, err
	}
	if err := write("hash.txt", "text/plain; charset=utf-8", []byte(item.Context.Manifest.SHA256+"\n")); err != nil {
		return nil, 0, 0, err
	}
	fileMap := remoteFileMapDocument{Protocol: "wharness.remote-file-map/v1", Generation: state.generation, ContextSHA256: item.Context.Manifest.SHA256, Files: entries}
	fileMapRaw, err := marshalRemoteChannelJSON(fileMap)
	if err != nil {
		return nil, 0, 0, err
	}
	if err := write("file-map.json", "application/json", fileMapRaw); err != nil {
		return nil, 0, 0, err
	}
	diffCheckRaw, err := marshalRemoteChannelJSON(remoteDiffCheck(state, resourceURL))
	if err != nil {
		return nil, 0, 0, err
	}
	if err := write("diff-check.json", "application/json", diffCheckRaw); err != nil {
		return nil, 0, 0, err
	}
	document := remoteChannelDocument{Protocol: "wharness.remote-channel/v2", RootRequestID: state.rootRequestID, ActiveRequestID: request.RequestID, Generation: state.generation, ContextSHA256: item.Context.Manifest.SHA256, Prompt: resourceURL("prompt.md"), FileMap: resourceURL("file-map.json"), DiffCheck: resourceURL("diff-check.json"), Hash: resourceURL("hash.txt"), Events: resourceURL("events"), BundleContract: resourceURL("bundle-contract.json"), Status: "active", UpdatedAt: time.Now().UTC().Format(time.RFC3339Nano), FinalCheckMessage: remoteFinalDiffCheckInstruction}
	stateRaw, err := marshalRemoteChannelJSON(document)
	if err != nil {
		return nil, 0, 0, err
	}
	if err := write("state.json", "application/json", stateRaw); err != nil {
		return nil, 0, 0, err
	}
	if includeManifest {
		manifest := map[string]any{"protocol": "wharness.remote-channel/v2", "root_request_id": state.rootRequestID, "state": resourceURL("state.json"), "prompt": resourceURL("prompt.md"), "file_map": resourceURL("file-map.json"), "diff_check": resourceURL("diff-check.json"), "hash": resourceURL("hash.txt"), "events": resourceURL("events"), "bundle_contract": resourceURL("bundle-contract.json"), "instructions": []string{"Use only the absolute endpoint URLs supplied in this bootstrap, manifest, state, diff check, and file map; do not construct sibling URLs.", "Read state.json, prompt.md, then file-map.json. The map is the complete allowlist of individual context, attachment, and artifact file URLs.", "Fetch only the individual files required to answer the request. Verify their SHA-256 values against the map when your runtime can do so.", "Retry transient connection, DNS, or 5xx retrieval failures with bounded backoff; this tunnel remains available for the Wharness session.", remoteFinalDiffCheckInstruction, "Return only the canonical " + expectedFilename + "."}}
		manifestRaw, err := marshalRemoteChannelJSON(manifest)
		if err != nil {
			return nil, 0, 0, err
		}
		if err := write("manifest.json", "application/json", manifestRaw); err != nil {
			return nil, 0, 0, err
		}
		contract := map[string]any{"protocol": "wharness.execution-bundle/v1", "filename": expectedFilename, "required_context_field": "base_context_sha256", "outcome_status_values": []string{"completed", "failed", "partial"}, "outcome_rule": "Use completed only when the request was actually completed; otherwise use failed or partial and explain the truthful result.", "events_optional": true, "final_diff_check": resourceURL("diff-check.json"), "patch_delivery": "patch_file", "patch_file_rule": "Raw UTF-8 unified diff only; never Markdown or fenced text. Each diff --git header is exactly: diff --git a/relative/path b/relative/path — exactly two unquoted paths, no backslash or extra text.", "patch_self_check": []string{"every patch_file resolves under patches/*.patch", "no patch file contains ```", "every diff --git header has exactly two paths", "fetch diff-check.json immediately before delivery", "git apply --check accepts every patch against the current context"}}
		contractRaw, err := marshalRemoteChannelJSON(contract)
		if err != nil {
			return nil, 0, 0, err
		}
		if err := write("bundle-contract.json", "application/json", contractRaw); err != nil {
			return nil, 0, 0, err
		}
	}
	var total, largest int64
	for _, resource := range resources {
		total += resource.Bytes
		largest = max(largest, resource.Bytes)
	}
	return resources, total, largest, nil
}

func (s *Service) remoteChannelResult(chatID, requestID string, publications []RemoteInputPublication, state *remoteInputChannelState, size int64, manifestPath string) RemoteInputResult {
	if len(publications) == 0 {
		return RemoteInputResult{}
	}
	publication := publications[0]
	raw, _ := os.ReadFile(manifestPath)
	digestText := state.manifestDigest
	if digestText == "" && len(raw) > 0 {
		digest := sha256.Sum256(raw)
		digestText = hex.EncodeToString(digest[:])
		state.manifestDigest = digestText
	}
	url := publication.URL
	base := strings.TrimSuffix(url, "/manifest.json")
	statusURL := tunnelStatusURL(url)
	tunnels := make([]RemoteInputTunnel, 0, len(publications))
	for _, item := range publications {
		tunnels = append(tunnels, RemoteInputTunnel{Provider: item.Provider, InstanceID: item.InstanceID, Manifest: item.URL, Status: tunnelStatusURL(item.URL)})
	}
	subID := ""
	if requestID != state.rootRequestID {
		subID = requestID
	}
	expectedFilename := bundlename.Build(bundlename.KindResponse, chatID, state.rootRequestID, subID)
	bootstrap := fmt.Sprintf("WHARNESS LIVE INPUT %s\nUse these exact pre-authorized absolute URLs; do not construct sibling URLs. Do not download ZIP context or attachment archives: this channel uses a file map with one authorized route per file.\nPRIMARY STATUS: %s\nPRIMARY MANIFEST: %s\nPRIMARY STATE: %s/state.json\nPRIMARY PROMPT: %s/prompt.md\nPRIMARY FILE MAP: %s/file-map.json\nPRIMARY HASH: %s/hash.txt\nPRIMARY DIFF CHECK: %s/diff-check.json\nPRIMARY BUNDLE CONTRACT: %s/bundle-contract.json\nOPTIONAL EVENTS: %s/events\nMANIFEST SHA-256: %s\nSSE/events are optional telemetry: never wait, block, fail, or report sse_transport_unsupported when streaming is unavailable. Ordinary HTTPS GET requests are sufficient. First fetch STATUS for each tunnel attempted. Try the tunnel endpoints below in listed priority order and use one only when protocol is wharness.tunnel-status/v1 and status is ok. On DNS, connection, timeout, invalid-status, or 5xx failure, continue with the next tunnel. After one succeeds, read its manifest, state, prompt and file map; fetch only needed individual files from the absolute URLs in that file map. Immediately before delivery, perform the DIFF CHECK using the freshest reachable tunnel; if that tunnel fails, try the next tunnel in priority order. Revalidate every actual patch against current touched files. The only valid outcome.status values are completed, failed, or partial. Return only %s.\n%s", requestID, statusURL, url, base, base, base, base, base, base, base, digestText, expectedFilename, remoteTunnelList(tunnels))
	return RemoteInputResult{Mode: "tunnel", Provider: publication.Provider, InstanceID: state.instanceID, BootstrapPrompt: bootstrap, FallbackPrompt: remoteFallbackPrompt(requestID, tunnels), Tunnels: tunnels, SHA256: digestText, Bytes: size, ExpiresAt: time.Now().UTC().Add(RemoteInputRetention), IncludedContext: true}
}

func remoteTunnelList(tunnels []RemoteInputTunnel) string {
	var builder strings.Builder
	builder.WriteString("TUNNELS (priority order):\n")
	for index, tunnel := range tunnels {
		fmt.Fprintf(&builder, "%d. provider=%s instance=%s STATUS: %s MANIFEST: %s\n", index+1, tunnel.Provider, tunnel.InstanceID, tunnel.Status, tunnel.Manifest)
	}
	return builder.String()
}

func remoteFallbackPrompt(requestID string, tunnels []RemoteInputTunnel) string {
	var builder strings.Builder
	builder.WriteString("OPTIONAL LIVE WHARNESS FALLBACK\nThe attached request ZIP is authoritative and sufficient. Never block solely because a live endpoint fails. You MAY use these tunnels, in listed priority order, to obtain newer prompt/context state, individual file diffs, or read-only events. Before delivering the final bundle you MUST perform a final diff compatibility check: fetch STATUS then diff-check.json, state.json, and file-map.json from the highest-priority reachable tunnel; compare current changes with the actual patch paths and re-check every patch against current touched files. If that tunnel fails due to DNS, connection, timeout, invalid status, or 5xx, try the next tunnel. If no tunnel works at final check, do not block: create the requested bundle from the attached ZIP and report outcome truthfully.\nREQUEST: ")
	builder.WriteString(requestID)
	builder.WriteString("\n")
	builder.WriteString(remoteTunnelList(tunnels))
	return builder.String()
}

func tunnelStatusURL(manifestURL string) string {
	parsed, err := url.Parse(manifestURL)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" {
		return ""
	}
	return parsed.Scheme + "://" + parsed.Host + "/status"
}
