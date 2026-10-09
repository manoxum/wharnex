package remotemap

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"unicode/utf8"

	"kernl.local/harness/backend/internal/domain"
)

// Build exposes individually addressable files backed by the authoritative
// snapshot. The ZIP itself remains a local audit artifact.
func Build(dir, archive string, manifest domain.ContextManifest, selected []string, files []File, previous []Entry, resourceURL func(string) string) ([]Resource, []Entry, error) {
	b := builder{dir: dir, url: resourceURL, existing: make(map[string]Entry, len(previous)), seen: make(map[string]bool)}
	for _, entry := range previous {
		if entry.Role != "" && entry.SHA256 != "" {
			b.existing[entry.Role+":"+entry.SHA256] = entry
		}
	}
	for _, file := range files {
		if err := b.add(file); err != nil {
			return nil, nil, err
		}
	}
	selection := selectedPaths(selected)
	for _, file := range manifest.Files {
		if !SafePath(file.Path) || file.SHA256 == "" {
			continue
		}
		if b.reuse("context", file.Path, file.SHA256, file.Size, selection[file.Path]) {
			continue
		}
		resourcePath := "files/context/" + file.SHA256
		contentType := file.ContentType
		if contentType == "" {
			contentType = "application/octet-stream"
		}
		if !b.seen[resourcePath] {
			b.resources = append(b.resources, Resource{Path: resourcePath, ContentType: contentType, Bytes: file.Size, ArchivePath: archive, ArchiveEntry: file.Path, ArchiveID: manifest.SHA256})
			b.seen[resourcePath] = true
		}
		b.entries = append(b.entries, Entry{Path: file.Path, URL: resourceURL(resourcePath), SHA256: file.SHA256, Bytes: file.Size, ContentType: contentType, Role: "context", Selected: selection[file.Path]})
	}
	sort.Slice(b.entries, func(i, j int) bool {
		return b.entries[i].Role+":"+b.entries[i].Path < b.entries[j].Role+":"+b.entries[j].Path
	})
	return b.resources, b.entries, nil
}

type builder struct {
	dir       string
	url       func(string) string
	existing  map[string]Entry
	seen      map[string]bool
	resources []Resource
	entries   []Entry
}

func (b *builder) reuse(role, displayPath, digest string, size int64, selected bool) bool {
	previous, ok := b.existing[role+":"+digest]
	if !ok {
		return false
	}
	b.entries = append(b.entries, Entry{Path: displayPath, URL: b.url("files/" + role + "/" + digest), SHA256: digest, Bytes: size, ContentType: previous.ContentType, Role: role, Selected: selected})
	return true
}

func (b *builder) add(file File) error {
	digest := sha256.Sum256(file.Raw)
	digestText := hex.EncodeToString(digest[:])
	if b.reuse(file.Role, file.Path, digestText, int64(len(file.Raw)), file.Selected) {
		return nil
	}
	resourcePath := "files/" + file.Role + "/" + digestText
	contentType := "application/octet-stream"
	if utf8.Valid(file.Raw) && !strings.ContainsRune(string(file.Raw), '\x00') {
		contentType = "text/plain; charset=utf-8"
	}
	if !b.seen[resourcePath] {
		target := filepath.Join(b.dir, filepath.FromSlash(resourcePath))
		if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
			return err
		}
		if err := os.WriteFile(target, file.Raw, 0o600); err != nil {
			return err
		}
		b.resources = append(b.resources, Resource{Path: resourcePath, FilePath: target, ContentType: contentType, Bytes: int64(len(file.Raw))})
		b.seen[resourcePath] = true
	}
	b.entries = append(b.entries, Entry{Path: file.Path, URL: b.url(resourcePath), SHA256: digestText, Bytes: int64(len(file.Raw)), ContentType: contentType, Role: file.Role, Selected: file.Selected})
	return nil
}

func SafePath(value string) bool {
	clean := path.Clean(strings.TrimSpace(value))
	return value != "" && clean == value && !strings.HasPrefix(clean, "/") && clean != "." && !strings.HasPrefix(clean, "../")
}
