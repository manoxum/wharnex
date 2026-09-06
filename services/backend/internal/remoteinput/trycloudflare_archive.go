package remoteinput

import (
	"archive/zip"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"kernl.local/harness/backend/internal/app"
)

const tryCloudflareArchiveIndexProtocol = "wharness.tunnel-archive-index/v1"

type tryCloudflareArchiveRoute struct {
	Path         string `json:"path"`
	ArchiveID    string `json:"archive_id"`
	ArchiveEntry string `json:"archive_entry"`
	ContentType  string `json:"content_type"`
	Bytes        int64  `json:"bytes"`
}

type tryCloudflareArchiveIndex struct {
	Protocol string                      `json:"protocol"`
	Routes   []tryCloudflareArchiveRoute `json:"routes"`
}

func (p *TryCloudflareProvider) installArchiveResourceLocked(channelID string, channel *tryCloudflareChannel, resource app.RemoteInputChannelResource) error {
	if !tryCloudflareChannelPattern.MatchString(channelID) || !tryCloudflareHashPattern.MatchString(resource.ArchiveID) || !safeArchiveEntry(resource.ArchiveEntry) {
		return errors.New("invalid TryCloudflare archive-backed resource")
	}
	root := filepath.Join(p.dir, "channels", channelID, ".snapshots")
	if err := os.MkdirAll(root, 0o700); err != nil {
		return err
	}
	target := filepath.Join(root, resource.ArchiveID+".zip")
	if _, err := os.Stat(target); os.IsNotExist(err) {
		if err := copyPrivateFile(resource.ArchivePath, target); err != nil {
			return fmt.Errorf("copy channel context snapshot: %w", err)
		}
	} else if err != nil {
		return err
	}
	channel.resources[resource.Path] = tryCloudflareResource{
		archivePath: target, archiveEntry: resource.ArchiveEntry,
		contentType: resource.ContentType, bytes: resource.Bytes,
	}
	return nil
}

func persistArchiveRouteIndex(root string, channel *tryCloudflareChannel) error {
	index := tryCloudflareArchiveIndex{Protocol: tryCloudflareArchiveIndexProtocol}
	for resourcePath, resource := range channel.resources {
		if resource.archivePath == "" {
			continue
		}
		archiveID := strings.TrimSuffix(filepath.Base(resource.archivePath), ".zip")
		index.Routes = append(index.Routes, tryCloudflareArchiveRoute{
			Path: resourcePath, ArchiveID: archiveID, ArchiveEntry: resource.archiveEntry,
			ContentType: resource.contentType, Bytes: resource.bytes,
		})
	}
	sort.Slice(index.Routes, func(i, j int) bool { return index.Routes[i].Path < index.Routes[j].Path })
	raw, err := json.MarshalIndent(index, "", "  ")
	if err != nil {
		return err
	}
	dir := filepath.Join(root, ".snapshots")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(dir, ".routes-*.json")
	if err != nil {
		return err
	}
	name := temporary.Name()
	defer os.Remove(name)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return err
	}
	if _, err := temporary.Write(raw); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return os.Rename(name, filepath.Join(dir, "routes.json"))
}

func loadArchiveRouteIndex(root string, channel *tryCloudflareChannel) error {
	raw, err := os.ReadFile(filepath.Join(root, ".snapshots", "routes.json"))
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	var index tryCloudflareArchiveIndex
	if err := json.Unmarshal(raw, &index); err != nil || index.Protocol != tryCloudflareArchiveIndexProtocol {
		return errors.New("persisted tunnel archive index is invalid")
	}
	for _, route := range index.Routes {
		if !validChannelResourcePath(route.Path) || !validChannelContentType(route.Path, route.ContentType) || !tryCloudflareHashPattern.MatchString(route.ArchiveID) || !safeArchiveEntry(route.ArchiveEntry) || route.Bytes < 0 {
			return errors.New("persisted tunnel archive route is invalid")
		}
		archivePath := filepath.Join(root, ".snapshots", route.ArchiveID+".zip")
		info, err := os.Lstat(archivePath)
		if err != nil || !info.Mode().IsRegular() {
			return errors.New("persisted tunnel archive snapshot is unavailable")
		}
		channel.resources[route.Path] = tryCloudflareResource{archivePath: archivePath, archiveEntry: route.ArchiveEntry, contentType: route.ContentType, bytes: route.Bytes}
	}
	return nil
}

func serveArchivedChannelResource(w http.ResponseWriter, r *http.Request, resource tryCloudflareResource) {
	archive, err := zip.OpenReader(resource.archivePath)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer archive.Close()
	var selected *zip.File
	for _, entry := range archive.File {
		if entry.Name == resource.archiveEntry && !entry.FileInfo().IsDir() {
			selected = entry
			break
		}
	}
	if selected == nil || int64(selected.UncompressedSize64) != resource.bytes {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", resource.contentType)
	w.Header().Set("Content-Length", strconv.FormatInt(resource.bytes, 10))
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if r.Method == http.MethodHead {
		w.WriteHeader(http.StatusOK)
		return
	}
	input, err := selected.Open()
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer input.Close()
	_, _ = io.Copy(w, input)
}

func safeArchiveEntry(value string) bool {
	clean := path.Clean(strings.TrimSpace(value))
	return value != "" && clean == value && clean != "." && !strings.HasPrefix(clean, "/") && !strings.HasPrefix(clean, "../")
}
