package contextbundle

import (
	"archive/zip"
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"unicode/utf8"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/ids"
)

type Builder struct {
	maxContextBytes int64
	maxBundleBytes  int64
}

func NewBuilder(maxContextBytes, maxBundleBytes int64) *Builder {
	return &Builder{maxContextBytes: maxContextBytes, maxBundleBytes: maxBundleBytes}
}

func (b *Builder) Build(projectRoot string) (domain.ContextBundle, error) {
	root, err := filepath.Abs(projectRoot)
	if err != nil {
		return domain.ContextBundle{}, fmt.Errorf("resolve project path: %w", err)
	}
	info, err := os.Stat(root)
	if err != nil || !info.IsDir() {
		return domain.ContextBundle{}, errors.New("project path must be an existing directory")
	}

	id := ids.New("ctx")
	tmpDir, err := os.MkdirTemp("", "wharness-context-*")
	if err != nil {
		return domain.ContextBundle{}, err
	}
	zipPath := filepath.Join(tmpDir, id+".zip")
	textPath := filepath.Join(tmpDir, id+".txt")
	manifest, err := b.writeArtifacts(root, id, zipPath, textPath)
	if err != nil {
		_ = os.RemoveAll(tmpDir)
		return domain.ContextBundle{}, err
	}
	return domain.ContextBundle{ID: id, ZipPath: zipPath, TextPath: textPath, Manifest: manifest}, nil
}

func (b *Builder) writeArtifacts(root, id, zipPath, textPath string) (domain.ContextManifest, error) {
	zipFile, err := os.Create(zipPath)
	if err != nil {
		return domain.ContextManifest{}, err
	}
	defer zipFile.Close()
	zw := zip.NewWriter(zipFile)
	defer zw.Close()

	textFile, err := os.Create(textPath)
	if err != nil {
		return domain.ContextManifest{}, err
	}
	defer textFile.Close()
	textWriter := bufio.NewWriter(textFile)
	defer textWriter.Flush()

	manifest := domain.ContextManifest{ID: id, ProjectRoot: root}
	patterns := LoadIgnorePatterns(root)
	var bundleBytes, contextBytes int64
	projectHash := sha256.New()

	err = filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		rel, err := filepath.Rel(root, path)
		if err != nil || rel == "." {
			return err
		}
		rel = filepath.ToSlash(rel)
		if ShouldIgnoreWithPatterns(rel, entry.IsDir(), patterns) {
			manifest.Excluded = append(manifest.Excluded, rel)
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if entry.IsDir() || entry.Type()&os.ModeSymlink != 0 {
			if entry.Type()&os.ModeSymlink != 0 {
				manifest.Excluded = append(manifest.Excluded, rel+" (symlink)")
			}
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if bundleBytes+info.Size() > b.maxBundleBytes {
			manifest.Excluded = append(manifest.Excluded, rel+" (bundle limit)")
			return nil
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		if containsSecret(data) {
			manifest.Excluded = append(manifest.Excluded, rel+" (secret-like content)")
			return nil
		}
		h := sha256.Sum256(data)
		sha := hex.EncodeToString(h[:])
		manifest.Files = append(manifest.Files, domain.ContextFile{Path: rel, Size: int64(len(data)), SHA256: sha})
		_, _ = io.WriteString(projectHash, rel+":"+sha+"\n")

		header, err := zip.FileInfoHeader(info)
		if err != nil {
			return err
		}
		header.Name = rel
		header.Method = zip.Deflate
		writer, err := zw.CreateHeader(header)
		if err != nil {
			return err
		}
		if _, err := writer.Write(data); err != nil {
			return err
		}
		bundleBytes += int64(len(data))

		if looksText(data) && contextBytes < b.maxContextBytes {
			prefix := []byte("\n===== FILE: " + rel + " =====\n")
			remaining := b.maxContextBytes - contextBytes
			chunk := append(prefix, data...)
			if int64(len(chunk)) > remaining {
				chunk = chunk[:remaining]
				manifest.TextTruncated = true
			}
			if _, err := textWriter.Write(chunk); err != nil {
				return err
			}
			contextBytes += int64(len(chunk))
		}
		return nil
	})
	if err != nil {
		return domain.ContextManifest{}, err
	}
	sort.Slice(manifest.Files, func(i, j int) bool { return manifest.Files[i].Path < manifest.Files[j].Path })
	sort.Strings(manifest.Excluded)
	manifest.SHA256 = hex.EncodeToString(projectHash.Sum(nil))
	manifestJSON, _ := json.MarshalIndent(manifest, "", "  ")
	_, _ = textWriter.WriteString("\n\n===== KERNL CONTEXT MANIFEST =====\n")
	_, _ = textWriter.Write(manifestJSON)
	return manifest, nil
}

func LoadIgnorePatterns(root string) []string {
	data, err := os.ReadFile(filepath.Join(root, ".harnessignore"))
	if err != nil {
		return nil
	}
	var patterns []string
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		line = strings.TrimPrefix(filepath.ToSlash(line), "./")
		patterns = append(patterns, line)
	}
	return patterns
}

func ShouldIgnoreWithPatterns(rel string, isDir bool, patterns []string) bool {
	if ShouldIgnore(rel, isDir) {
		return true
	}
	rel = strings.TrimPrefix(filepath.ToSlash(rel), "./")
	base := path.Base(rel)
	for _, pattern := range patterns {
		pattern = strings.TrimSuffix(pattern, "/")
		if pattern == "" {
			continue
		}
		if matched, _ := path.Match(pattern, rel); matched {
			return true
		}
		if matched, _ := path.Match(pattern, base); matched {
			return true
		}
		if rel == pattern || strings.HasPrefix(rel, pattern+"/") {
			return true
		}
	}
	return false
}

func ShouldIgnore(rel string, isDir bool) bool {
	rel = strings.TrimPrefix(filepath.ToSlash(rel), "./")
	parts := strings.Split(strings.ToLower(rel), "/")
	base := parts[len(parts)-1]
	blockedDirs := map[string]bool{
		".git": true, "node_modules": true, "dist": true, "build": true,
		"coverage": true, ".next": true, ".vite": true, ".harness": true,
		"vendor": true, "secrets": true, ".ssh": true, ".aws": true, ".gnupg": true,
	}
	if isDir && blockedDirs[base] {
		return true
	}
	blockedNames := map[string]bool{
		".env": true, "credentials.json": true, "id_rsa": true, "id_ed25519": true, ".npmrc": true, ".netrc": true, ".pypirc": true, ".git-credentials": true, "auth.json": true,
	}
	safeEnvTemplate := base == ".env.example" || base == ".env.sample" || base == ".env.template"
	if blockedNames[base] || (strings.HasPrefix(base, ".env.") && !safeEnvTemplate) {
		return true
	}
	for _, ext := range []string{".pem", ".key", ".p12", ".pfx", ".db", ".sqlite", ".sqlite3", ".dump"} {
		if strings.HasSuffix(base, ext) {
			return true
		}
	}
	return false
}

func containsSecret(data []byte) bool {
	if len(data) == 0 || !looksText(data) {
		return false
	}
	s := strings.ToUpper(string(data))
	markers := []string{
		"-----BEGIN PRIVATE KEY-----", "-----BEGIN RSA PRIVATE KEY-----",
		"OPENAI_API_KEY=SK-", "AWS_SECRET_ACCESS_KEY=", "GITHUB_TOKEN=GHP_",
	}
	for _, marker := range markers {
		if strings.Contains(s, marker) {
			return true
		}
	}
	return false
}

func looksText(data []byte) bool {
	limit := len(data)
	if limit > 8192 {
		limit = 8192
	}
	for _, b := range data[:limit] {
		if b == 0 {
			return false
		}
	}
	return utf8.Valid(data)
}
