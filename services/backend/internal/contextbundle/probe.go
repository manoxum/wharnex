package contextbundle

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"kernl.local/harness/backend/internal/projectconfig"
)

// SourceProbe is a lightweight dirty detector for an already-built managed
// context. It uses filesystem metadata only; the authoritative SHA-256 still
// comes from Build. A changed probe therefore triggers a full rebuild, while an
// unchanged probe avoids repeatedly re-reading and recompressing the project.
func SourceProbe(projectRoot string) (string, error) {
	root, err := filepath.Abs(projectRoot)
	if err != nil {
		return "", err
	}
	cfg, err := projectconfig.Load(root)
	if err != nil {
		return "", err
	}
	patterns := LoadIgnorePatterns(root)
	hash := sha256.New()
	writeProbe := func(rel string, info fs.FileInfo) {
		fmt.Fprintf(hash, "%s\x00%d\x00%d\x00%d\n", filepath.ToSlash(rel), info.Size(), info.Mode(), info.ModTime().UnixNano())
	}
	err = filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		rel, err := filepath.Rel(root, path)
		if err != nil || rel == "." {
			return err
		}
		rel = filepath.ToSlash(rel)
		if entry.Type()&os.ModeSymlink != 0 {
			info, statErr := entry.Info()
			if statErr == nil {
				writeProbe(rel, info)
			}
			return nil
		}
		if reason, _, ignored := contextExclusion(rel, entry.IsDir(), patterns, cfg.Context); ignored {
			_ = reason
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if entry.IsDir() {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		writeProbe(rel, info)
		return nil
	})
	if err != nil {
		return "", err
	}
	writeGitProbeSignals(root, hash)
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func writeGitProbeSignals(root string, hash interface{ Write([]byte) (int, error) }) {
	gitRoot := filepath.Join(root, ".git")
	info, err := os.Lstat(gitRoot)
	if err != nil {
		return
	}
	_, _ = fmt.Fprintf(hash, ".git\x00%d\x00%d\x00%d\n", info.Size(), info.Mode(), info.ModTime().UnixNano())
	if !info.IsDir() {
		return
	}
	var paths []string
	for _, name := range []string{"HEAD", "index", "packed-refs", "refs", "worktrees"} {
		base := filepath.Join(gitRoot, name)
		_ = filepath.WalkDir(base, func(path string, entry fs.DirEntry, walkErr error) error {
			if walkErr != nil {
				return nil
			}
			if entry.Type()&os.ModeSymlink != 0 {
				return nil
			}
			paths = append(paths, path)
			return nil
		})
	}
	sort.Strings(paths)
	for _, candidate := range paths {
		info, err := os.Stat(candidate)
		if err != nil {
			continue
		}
		rel, err := filepath.Rel(root, candidate)
		if err != nil || strings.HasPrefix(filepath.ToSlash(rel), "../") {
			continue
		}
		_, _ = fmt.Fprintf(hash, "%s\x00%d\x00%d\x00%d\n", filepath.ToSlash(rel), info.Size(), info.Mode(), info.ModTime().UnixNano())
	}
}
