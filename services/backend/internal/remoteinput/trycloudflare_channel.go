package remoteinput

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"kernl.local/harness/backend/internal/app"
)

var tryCloudflareChannelPattern = regexp.MustCompile(`^[a-f0-9]{32,64}$`)
var tryCloudflarePromptPathPattern = regexp.MustCompile(`^prompts/[A-Za-z0-9._-]{1,180}\.md$`)

// Keep this closed list aligned with every role emitted by
// buildRemoteFileMapResources. An omitted producer role makes the optional
// live channel fail wholesale even though every individual resource is still
// content-addressed and otherwise valid.
var tryCloudflareFilePathPattern = regexp.MustCompile(`^files/(context|knowledge|continuation|attachment|artifact)/[a-f0-9]{64}$`)
var tryCloudflareHashPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)

type tryCloudflareChannel struct {
	resources   map[string]tryCloudflareResource
	subscribers map[chan []byte]struct{}
}

type tryCloudflareResource struct {
	filePath     string
	archivePath  string
	archiveEntry string
	contentType  string
	bytes        int64
}

func (p *TryCloudflareProvider) PublishChannel(ctx context.Context, request app.RemoteInputChannel) (Publication, error) {
	if !tryCloudflareChannelPattern.MatchString(request.ChannelID) || len(request.Resources) == 0 {
		return Publication{}, errors.New("invalid TryCloudflare request channel")
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if err := p.ensureTunnelLocked(ctx); err != nil {
		return Publication{}, err
	}
	if _, exists := p.channels[request.ChannelID]; exists {
		return Publication{}, errors.New("TryCloudflare request channel already exists")
	}
	channel := &tryCloudflareChannel{resources: make(map[string]tryCloudflareResource), subscribers: make(map[chan []byte]struct{})}
	if err := p.installChannelResourcesLocked(request.ChannelID, channel, request.Resources); err != nil {
		_ = os.RemoveAll(filepath.Join(p.dir, "channels", request.ChannelID))
		return Publication{}, err
	}
	if _, exists := channel.resources["manifest.json"]; !exists {
		_ = os.RemoveAll(filepath.Join(p.dir, "channels", request.ChannelID))
		return Publication{}, errors.New("TryCloudflare request channel requires manifest.json")
	}
	p.channels[request.ChannelID] = channel
	return Publication{Provider: p.Name(), URL: objectURL(p.public, request.ChannelID+"/manifest.json").String()}, nil
}

func (p *TryCloudflareProvider) UpdateChannel(_ context.Context, update app.RemoteInputChannelUpdate) error {
	if !tryCloudflareChannelPattern.MatchString(update.ChannelID) || !validChannelEvent(update.Event) {
		return errors.New("invalid TryCloudflare channel update")
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	channel := p.channels[update.ChannelID]
	if channel == nil {
		return errors.New("TryCloudflare request channel is not active")
	}
	if err := p.installChannelResourcesLocked(update.ChannelID, channel, update.Resources); err != nil {
		return err
	}
	p.broadcastChannelEventLocked(channel, update.Event, update.Data)
	return nil
}

func (p *TryCloudflareProvider) CloseChannel(_ context.Context, channelID string) error {
	if !tryCloudflareChannelPattern.MatchString(channelID) {
		return errors.New("invalid TryCloudflare request channel")
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	channel := p.channels[channelID]
	if channel == nil {
		return nil
	}
	p.broadcastChannelEventLocked(channel, "request.terminal", map[string]string{"status": "closed"})
	for subscriber := range channel.subscribers {
		close(subscriber)
	}
	delete(p.channels, channelID)
	if err := os.RemoveAll(filepath.Join(p.dir, "channels", channelID)); err != nil {
		return err
	}
	return nil
}

func (p *TryCloudflareProvider) installChannelResourcesLocked(channelID string, channel *tryCloudflareChannel, resources []app.RemoteInputChannelResource) error {
	archiveChanged := false
	for _, resource := range resources {
		if !validChannelResourcePath(resource.Path) || !validChannelContentType(resource.Path, resource.ContentType) {
			return fmt.Errorf("invalid TryCloudflare channel resource %q", resource.Path)
		}
		if resource.ArchivePath != "" {
			if resource.FilePath != "" {
				return fmt.Errorf("install channel resource %s: archive-backed resource cannot also have a file path", resource.Path)
			}
			if err := p.installArchiveResourceLocked(channelID, channel, resource); err != nil {
				return fmt.Errorf("install channel resource %s: %w", resource.Path, err)
			}
			archiveChanged = true
			continue
		}
		if resource.FilePath == "" {
			return fmt.Errorf("channel resource %s has no source", resource.Path)
		}
		target := filepath.Join(p.dir, "channels", channelID, filepath.FromSlash(resource.Path))
		if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
			return err
		}
		if err := copyPrivateFile(resource.FilePath, target); err != nil {
			return fmt.Errorf("copy channel resource %s: %w", resource.Path, err)
		}
		channel.resources[resource.Path] = tryCloudflareResource{filePath: target, contentType: resource.ContentType, bytes: resource.Bytes}
	}
	if archiveChanged {
		return persistArchiveRouteIndex(filepath.Join(p.dir, "channels", channelID), channel)
	}
	return nil
}

func validChannelResourcePath(path string) bool {
	switch path {
	case "manifest.json", "state.json", "hash.txt", "bundle-contract.json", "prompt.md", "file-map.json", "diff-check.json":
		return true
	default:
		return tryCloudflarePromptPathPattern.MatchString(path) || tryCloudflareFilePathPattern.MatchString(path)
	}
}

func validChannelContentType(path, contentType string) bool {
	if strings.HasSuffix(path, ".json") {
		return contentType == "application/json"
	}
	if path == "hash.txt" || path == "prompt.md" || strings.HasPrefix(path, "prompts/") {
		return contentType == "text/plain; charset=utf-8"
	}
	return tryCloudflareFilePathPattern.MatchString(path) && (contentType == "text/plain; charset=utf-8" || contentType == "application/octet-stream")
}

func validChannelEvent(event string) bool {
	switch event {
	case "request.ready", "prompt.changed", "context.changed", "attachments.changed", "comment.added", "request.superseded", "request.terminal":
		return true
	default:
		return false
	}
}

func (p *TryCloudflareProvider) broadcastChannelEventLocked(channel *tryCloudflareChannel, event string, data map[string]string) {
	keys := make([]string, 0, len(data))
	for key := range data {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	var body strings.Builder
	body.WriteString("event: " + event + "\n")
	for _, key := range keys {
		value := strings.NewReplacer("\r", " ", "\n", " ").Replace(data[key])
		body.WriteString("data: " + key + "=" + value + "\n")
	}
	body.WriteString("\n")
	raw := []byte(body.String())
	for subscriber := range channel.subscribers {
		select {
		case subscriber <- raw:
		default:
		}
	}
}

func (p *TryCloudflareProvider) serveChannelHTTP(w http.ResponseWriter, r *http.Request, name string) {
	parts := strings.SplitN(name, "/", 2)
	if len(parts) != 2 || !tryCloudflareChannelPattern.MatchString(parts[0]) {
		http.NotFound(w, r)
		return
	}
	channelID, resourcePath := parts[0], parts[1]
	if resourcePath == "events" {
		p.serveChannelEvents(w, r, channelID)
		return
	}
	if !validChannelResourcePath(resourcePath) {
		http.NotFound(w, r)
		return
	}
	p.mu.Lock()
	channel := p.channels[channelID]
	resource, ok := tryCloudflareResource{}, false
	if channel != nil {
		resource, ok = channel.resources[resourcePath]
	}
	p.mu.Unlock()
	if !ok {
		http.NotFound(w, r)
		return
	}
	if resource.archivePath != "" {
		serveArchivedChannelResource(w, r, resource)
		return
	}
	file, err := os.Open(resource.filePath)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", resource.contentType)
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	http.ServeContent(w, r, filepath.Base(resourcePath), info.ModTime(), file)
}

func (p *TryCloudflareProvider) serveChannelEvents(w http.ResponseWriter, r *http.Request, channelID string) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	subscriber := make(chan []byte, 8)
	p.mu.Lock()
	channel := p.channels[channelID]
	if channel == nil {
		p.mu.Unlock()
		http.NotFound(w, r)
		return
	}
	channel.subscribers[subscriber] = struct{}{}
	p.mu.Unlock()
	defer p.removeChannelSubscriber(channelID, subscriber)
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Accel-Buffering", "no")
	if r.Method == http.MethodHead {
		return
	}
	_, _ = io.WriteString(w, "event: request.ready\ndata: status=active\n\n")
	flusher.Flush()
	p.streamChannelEvents(w, r, flusher, subscriber)
}
