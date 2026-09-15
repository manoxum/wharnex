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
	"time"
	"unicode/utf8"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/exportmeta"
	"kernl.local/harness/backend/internal/ids"
	"kernl.local/harness/backend/internal/projectconfig"
)

type Builder struct {
	maxContextBytes int64
	maxBundleBytes  int64
}

func NewBuilder(maxContextBytes, maxBundleBytes int64) *Builder {
	return &Builder{maxContextBytes: maxContextBytes, maxBundleBytes: maxBundleBytes}
}

func (b *Builder) Build(projectRoot string) (domain.ContextBundle, error) {
	return b.build(projectRoot, nil)
}

// BuildWithContextConfig builds one project with a request-local selection.
// It never writes that selection to the project's whaness.yml.
func (b *Builder) BuildWithContextConfig(projectRoot string, selection projectconfig.ContextConfig) (domain.ContextBundle, error) {
	return b.build(projectRoot, &selection)
}

func (b *Builder) build(projectRoot string, selection *projectconfig.ContextConfig) (domain.ContextBundle, error) {
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
	cfg, _, err := projectconfig.Ensure(root)
	if err != nil {
		_ = os.RemoveAll(tmpDir)
		return domain.ContextBundle{}, fmt.Errorf("prepare %s: %w", projectconfig.FileName, err)
	}
	if selection != nil {
		cfg.Context = *selection
		if cfg.Context.MaxFileBytes <= 0 {
			cfg.Context.MaxFileBytes = projectconfig.DefaultMaxFileSize
		}
	}
	manifest, err := b.writeArtifacts(root, id, zipPath, textPath, cfg)
	if err != nil {
		_ = os.RemoveAll(tmpDir)
		return domain.ContextBundle{}, err
	}
	return domain.ContextBundle{ID: id, ZipPath: zipPath, TextPath: textPath, Manifest: manifest, WorkspaceSHA256: manifest.SHA256}, nil
}

func (b *Builder) writeArtifacts(root, id, zipPath, textPath string, cfg projectconfig.Config) (domain.ContextManifest, error) {
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
	exportMetadata := exportmeta.Capture(root, "managed-context", time.Time{})
	exportsData := exportMetadata.Markdown()
	if int64(len(exportsData)) > b.maxBundleBytes {
		return domain.ContextManifest{}, errors.New("EXPORTS.md exceeds context bundle limit")
	}
	if err := addContextFile(zw, textWriter, &manifest, projectHash, "EXPORTS.md", exportsData, 0o600, b.maxContextBytes, &bundleBytes, &contextBytes); err != nil {
		return domain.ContextManifest{}, err
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
		if rel == "EXPORTS.md" && !entry.IsDir() {
			return nil
		}
		if entry.Type()&os.ModeSymlink != 0 {
			addExcluded(&manifest, rel, "symlink", "symlink", "symlink")
			return nil
		}
		if reason, rule, ignored := contextExclusion(rel, entry.IsDir(), patterns, cfg.Context); ignored {
			kind := "file"
			if entry.IsDir() {
				kind = "directory"
			}
			addExcluded(&manifest, rel, kind, reason, rule)
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
		if info.Size() > cfg.Context.MaxFileBytes {
			addExcluded(&manifest, rel, "file", "file size limit", "file-size")
			return nil
		}
		if bundleBytes+info.Size() > b.maxBundleBytes {
			addExcluded(&manifest, rel, "file", "bundle limit", "bundle-limit")
			return nil
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		if containsSecret(data) {
			addExcluded(&manifest, rel, "file", "secret-like content", "secret-content")
			return nil
		}
		if cfg.Context.AutoExclude && !looksText(data) {
			addExcluded(&manifest, rel, "file", "binary content", "binary-content")
			return nil
		}
		return addContextFile(zw, textWriter, &manifest, projectHash, rel, data, info.Mode().Perm(), b.maxContextBytes, &bundleBytes, &contextBytes)
	})
	if err != nil {
		return domain.ContextManifest{}, err
	}
	sort.Slice(manifest.Files, func(i, j int) bool { return manifest.Files[i].Path < manifest.Files[j].Path })
	sort.Strings(manifest.Excluded)
	sort.Slice(manifest.ExcludedDetails, func(i, j int) bool { return manifest.ExcludedDetails[i].Path < manifest.ExcludedDetails[j].Path })
	manifest.SHA256 = hex.EncodeToString(projectHash.Sum(nil))
	manifestJSON, _ := json.MarshalIndent(manifest, "", "  ")
	_, _ = textWriter.WriteString("\n\n===== KERNL CONTEXT MANIFEST =====\n")
	_, _ = textWriter.Write(manifestJSON)
	return manifest, nil
}

// archiveExtensions is the invariant backing mandatoryBlockedExtensions: even
// if a future exclusion rule regresses, no archive entry ever reaches the
// context ZIP. This is the last line of defense against zip-in-zip, checked
// at the point of writing rather than only during the tree walk.
var archiveExtensions = []string{".zip", ".tar", ".tgz", ".gz", ".bz2", ".xz", ".7z", ".rar"}

func addContextFile(zw *zip.Writer, textWriter *bufio.Writer, manifest *domain.ContextManifest, projectHash io.Writer, rel string, data []byte, mode fs.FileMode, maxContextBytes int64, bundleBytes, contextBytes *int64) error {
	lowerRel := strings.ToLower(rel)
	for _, ext := range archiveExtensions {
		if strings.HasSuffix(lowerRel, ext) {
			return fmt.Errorf("refusing to nest archive entry %q into the context bundle", rel)
		}
	}
	h := sha256.Sum256(data)
	sha := hex.EncodeToString(h[:])
	contentType := "application/octet-stream"
	if looksText(data) {
		contentType = "text/plain; charset=utf-8"
	}
	manifest.Files = append(manifest.Files, domain.ContextFile{Path: rel, Size: int64(len(data)), SHA256: sha, ContentType: contentType})
	_, _ = io.WriteString(projectHash, rel+":"+sha+"\n")

	// Text is deflated; anything else is stored.
	//
	// Storing everything made the ZIP the raw byte sum of the project: a
	// 2,487-file project produced a 21 MB attachment, whose upload ChatGPT
	// timed out on four times before succeeding — roughly twenty minutes spent
	// answering a greeting. Measured on that project's own sources, deflating
	// text takes 7.66 MB to 1.95 MB, a 3.9x reduction.
	//
	// The original rule was "no recompression", and that half is kept: a
	// non-text entry is already-compressed media or an opaque payload, where
	// deflate spends CPU to gain nothing. Source text has never been
	// compressed before, so compressing it is not recompression. Archives
	// never reach here at all — the guard above refuses to nest one.
	//
	// Bundle identity is unaffected: the manifest SHA-256 is computed from
	// paths and content hashes, never from the archive bytes. The size budgets
	// above deliberately keep counting raw content, because they bound what the
	// planner reads rather than what the transport carries.
	method := zip.Store
	if contentType == "text/plain; charset=utf-8" {
		method = zip.Deflate
	}
	header := &zip.FileHeader{Name: rel, Method: method}
	header.SetMode(mode)
	writer, err := zw.CreateHeader(header)
	if err != nil {
		return err
	}
	if _, err := writer.Write(data); err != nil {
		return err
	}
	*bundleBytes += int64(len(data))

	if contentType == "text/plain; charset=utf-8" && *contextBytes < maxContextBytes {
		prefix := []byte("\n===== FILE: " + rel + " =====\n")
		remaining := maxContextBytes - *contextBytes
		chunk := append(prefix, data...)
		if int64(len(chunk)) > remaining {
			chunk = chunk[:remaining]
			manifest.TextTruncated = true
		}
		if _, err := textWriter.Write(chunk); err != nil {
			return err
		}
		*contextBytes += int64(len(chunk))
	}
	return nil
}

func addExcluded(manifest *domain.ContextManifest, rel, kind, reason, rule string) {
	manifest.Excluded = append(manifest.Excluded, rel+" ("+reason+")")
	manifest.ExcludedDetails = append(manifest.ExcludedDetails, domain.ContextExclusion{Path: rel, Kind: kind, Reason: reason, Rule: rule})
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
	// `.git` is excluded whether it is a directory or a file. In a submodule
	// and in a linked worktree it is a FILE holding `gitdir: <absolute host
	// path>`, so admitting it copied a pointer into the host's own repository
	// metadata straight into a sandbox and into the model's context — a
	// containment hole and a leak that the directory-only check missed
	// precisely on the repository shapes where it mattered.
	if base == ".git" {
		return true
	}
	if isDir {
		if stringIn(base, mandatoryBlockedDirs) {
			return true
		}
		for _, prefix := range mandatoryBlockedDirPrefixes {
			if strings.HasPrefix(base, prefix) {
				return true
			}
		}
	}
	safeEnvTemplate := base == ".env.example" || base == ".env.sample" || base == ".env.template"
	if stringIn(base, mandatoryBlockedNames) || (strings.HasPrefix(base, ".env.") && !safeEnvTemplate) {
		return true
	}
	for _, ext := range mandatoryBlockedExtensions {
		if strings.HasSuffix(base, ext) {
			return true
		}
	}
	return false
}

// mandatoryBlockedDirs also covers the package-manager content stores, which
// are dependency payloads rather than project source however they are spelled.
// A pnpm project configured with a repository-local `.pnpm-store` put 14,468
// content-addressed blobs into one project's context: the manifest alone was
// 5.8 MiB, six times the 1 MiB the Desktop can hand ChatGPT, so no prompt in
// that project could be delivered at all. `node_modules` was already blocked;
// these are the same thing under a different directory name.
var mandatoryBlockedDirs = []string{
	".git", "node_modules", "dist", "build", "coverage", ".next", ".vite", ".harness",
	"vendor", "secrets", ".ssh", ".aws", ".gnupg",
	".pnpm-store", ".pnpm", ".yarn-cache", ".turbo", ".parcel-cache",
	"__pycache__", ".venv", ".tox", ".mypy_cache", ".pytest_cache",
	// IDE metadata and generated test output. `AGENTS.md` §10 already asks for
	// both to be pruned; they were simply never named. One project carried
	// 0.92 MB of JetBrains datasource XML and 0.9 MB of Playwright report and
	// screenshots into every request, none of it project source.
	".idea", ".vscode", "playwright-report", "test-results", ".nyc_output",
}

// mandatoryBlockedDirPrefixes catches directories a prior bundle round-trip
// left behind (an extracted response, an exported request/context archive).
// Re-admitting their expanded contents into a new context bundle is how the
// system silently produced a bundle inside a bundle; this check runs before
// any project config and cannot be reopened by auto_exclude=false or an
// include pattern.
var mandatoryBlockedDirPrefixes = []string{
	"kernl-context-", "wharness-context-", "wharness-bundle-", "wharness-input-", "whx_bundle_",
}

var mandatoryBlockedNames = []string{
	".env", "credentials.json", "id_rsa", "id_ed25519", ".npmrc", ".netrc", ".pypirc", ".git-credentials", "auth.json",
}

// mandatoryBlockedExtensions includes archive formats deliberately: the
// context/request/response protocol promises at most one ZIP per exchange,
// and a pre-existing archive anywhere in the project tree must never become
// a nested entry of a new one, regardless of project configuration.
var mandatoryBlockedExtensions = []string{
	".pem", ".key", ".p12", ".pfx", ".db", ".sqlite", ".sqlite3", ".dump",
	".zip", ".tar", ".tgz", ".gz", ".bz2", ".xz", ".7z", ".rar",
	// Build caches and coverage output are generated text: they pass the binary
	// check and are large, so they reached the planner as though they were
	// source. `.sql` is deliberately NOT here — migrations are project source,
	// and this list cannot be reopened by project configuration.
	".tsbuildinfo", ".lcov",
}

func stringIn(value string, values []string) bool {
	for _, candidate := range values {
		if value == candidate {
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
