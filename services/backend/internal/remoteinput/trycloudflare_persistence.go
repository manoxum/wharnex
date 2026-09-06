package remoteinput

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

func (p *TryCloudflareProvider) loadChannels() error {
	root := filepath.Join(p.dir, "channels")
	entries, err := os.ReadDir(root)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("read persisted tunnel channels: %w", err)
	}
	for _, entry := range entries {
		if !entry.IsDir() || !tryCloudflareChannelPattern.MatchString(entry.Name()) {
			continue
		}
		channel, loadErr := loadPersistedChannel(filepath.Join(root, entry.Name()))
		if loadErr != nil {
			continue
		}
		p.channels[entry.Name()] = channel
	}
	return nil
}

func loadPersistedChannel(root string) (*tryCloudflareChannel, error) {
	channel := &tryCloudflareChannel{resources: make(map[string]tryCloudflareResource), subscribers: make(map[chan []byte]struct{})}
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if path == root {
			return nil
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return errors.New("persisted tunnel channel contains a link")
		}
		if entry.IsDir() {
			relative, err := filepath.Rel(root, path)
			if err != nil {
				return err
			}
			if filepath.ToSlash(relative) == ".snapshots" {
				return filepath.SkipDir
			}
			return nil
		}
		relative, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		resourcePath := filepath.ToSlash(relative)
		contentType := persistedChannelContentType(resourcePath)
		if !validChannelResourcePath(resourcePath) || contentType == "" {
			return errors.New("persisted tunnel channel contains an invalid resource")
		}
		channel.resources[resourcePath] = tryCloudflareResource{filePath: path, contentType: contentType}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if err := loadArchiveRouteIndex(root, channel); err != nil {
		return nil, err
	}
	if _, exists := channel.resources["manifest.json"]; !exists {
		return nil, errors.New("persisted tunnel channel has no manifest")
	}
	return channel, nil
}

func persistedChannelContentType(path string) string {
	switch {
	case strings.HasSuffix(path, ".json"):
		return "application/json"
	case path == "hash.txt":
		return "text/plain; charset=utf-8"
	case path == "prompt.md" || strings.HasPrefix(path, "prompts/") && strings.HasSuffix(path, ".md"):
		return "text/plain; charset=utf-8"
	case tryCloudflareFilePathPattern.MatchString(path):
		return "application/octet-stream"
	default:
		return ""
	}
}
