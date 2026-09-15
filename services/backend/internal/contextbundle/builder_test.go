package contextbundle

import (
	"archive/zip"
	"bufio"
	"bytes"
	"encoding/json"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/projectconfig"
)

func TestBuildExcludesSecrets(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, "main.go"), "package main\n")
	mustWrite(t, filepath.Join(root, ".env"), "TOKEN=secret\n")
	mustWrite(t, filepath.Join(root, "nested", "key.txt"), "-----BEGIN PRIVATE KEY-----\nabc")

	bundle, err := NewBuilder(1024*1024, 1024*1024).Build(root)
	if err != nil {
		t.Fatal(err)
	}
	zr, err := zip.OpenReader(bundle.ZipPath)
	if err != nil {
		t.Fatal(err)
	}
	defer zr.Close()
	names := make(map[string]bool, len(zr.File))
	for _, file := range zr.File {
		names[file.Name] = true
	}
	if !names["EXPORTS.md"] || !names["main.go"] || !names["whaness.yml"] || names[".env"] || names["nested/key.txt"] {
		t.Fatalf("unexpected zip files: %#v", names)
	}
}

func TestBuildWithContextConfigIsRequestLocal(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, "src", "main.go"), "package main\n")
	mustWrite(t, filepath.Join(root, "docs", "notes.md"), "notes\n")
	if _, _, err := projectconfig.Ensure(root); err != nil {
		t.Fatal(err)
	}
	bundle, err := NewBuilder(1024*1024, 1024*1024).BuildWithContextConfig(root, projectconfig.ContextConfig{
		AutoExclude: true, MaxFileBytes: projectconfig.DefaultMaxFileSize, Include: []string{"docs/**"},
	})
	if err != nil {
		t.Fatal(err)
	}
	names := zipNames(t, bundle.ZipPath)
	if !names["docs/notes.md"] || names["src/main.go"] {
		t.Fatalf("unexpected request-local selection: %#v", names)
	}
	persisted, err := projectconfig.Load(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(persisted.Context.Include) != 0 {
		t.Fatalf("request selection mutated project config: %#v", persisted.Context)
	}
}

func TestShouldIgnoreDependencyDirs(t *testing.T) {
	if !ShouldIgnore("services/frontend/node_modules", true) {
		t.Fatal("node_modules should be ignored")
	}
}

func mustWrite(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestHarnessIgnorePatterns(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, ".harnessignore"), "private-notes\n*.cache\n")
	patterns := LoadIgnorePatterns(root)
	if !ShouldIgnoreWithPatterns("private-notes/todo.md", false, patterns) {
		t.Fatal("configured directory should be ignored")
	}
	if !ShouldIgnoreWithPatterns("tmp/foo.cache", false, patterns) {
		t.Fatal("glob should be ignored")
	}
}

func TestBuildUsesWhanessContextConfiguration(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, "src", "main.go"), "package main\n")
	mustWrite(t, filepath.Join(root, "docs", "notes.md"), "notes\n")
	mustWrite(t, filepath.Join(root, "src", "generated.log"), "generated\n")
	mustWrite(t, filepath.Join(root, "whaness.yml"), `version: 1
project:
  name: "configured"
context:
  auto_exclude: true
  max_file_bytes: 2097152
  include:
    - "src/**"
  exclude:
    - "src/generated.log"
`)
	bundle, err := NewBuilder(1024*1024, 1024*1024).Build(root)
	if err != nil {
		t.Fatal(err)
	}
	zr, err := zip.OpenReader(bundle.ZipPath)
	if err != nil {
		t.Fatal(err)
	}
	defer zr.Close()
	names := make(map[string]bool, len(zr.File))
	for _, file := range zr.File {
		names[file.Name] = true
	}
	if len(zr.File) != 2 || !names["EXPORTS.md"] || !names["src/main.go"] {
		t.Fatalf("unexpected configured context files: %#v", names)
	}
}

func TestArchiveFilesAreExcludedEvenWithPermissiveConfig(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, "main.go"), "package main\n")
	mustWrite(t, filepath.Join(root, "patches", "wharness-bundle-req_20260904T072258_5f91019618e713ac.zip"), "not a real zip, content is irrelevant")
	mustWrite(t, filepath.Join(root, "whaness.yml"), `version: 1
project:
  name: "permissive"
context:
  auto_exclude: false
  max_file_bytes: 2097152
  include:
    - "*"
    - "patches/**"
`)
	bundle, err := NewBuilder(1024*1024, 1024*1024).Build(root)
	if err != nil {
		t.Fatal(err)
	}
	zr, err := zip.OpenReader(bundle.ZipPath)
	if err != nil {
		t.Fatal(err)
	}
	defer zr.Close()
	for _, file := range zr.File {
		if strings.HasSuffix(strings.ToLower(file.Name), ".zip") {
			t.Fatalf("archive entry %q reached the context bundle despite auto_exclude=false and a matching include pattern", file.Name)
		}
	}
}

func TestExtractedBundleDirectoriesAreExcludedEvenWithPermissiveConfig(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, "main.go"), "package main\n")
	mustWrite(t, filepath.Join(root, "patches", "wharness-bundle-req_20260904T072258_5f91019618e713ac(1)", "plan.json"), "{}")
	mustWrite(t, filepath.Join(root, "kernl-context-ses_20260902T193605_0584cbf8ce231c03", "notes.txt"), "leftover snapshot")
	mustWrite(t, filepath.Join(root, "whaness.yml"), `version: 1
project:
  name: "permissive"
context:
  auto_exclude: false
  max_file_bytes: 2097152
  include:
    - "*"
    - "patches/**"
`)
	bundle, err := NewBuilder(1024*1024, 1024*1024).Build(root)
	if err != nil {
		t.Fatal(err)
	}
	zr, err := zip.OpenReader(bundle.ZipPath)
	if err != nil {
		t.Fatal(err)
	}
	defer zr.Close()
	for _, file := range zr.File {
		if strings.Contains(file.Name, "wharness-bundle-") || strings.Contains(file.Name, "kernl-context-") {
			t.Fatalf("expanded prior-bundle content %q reached the new context bundle despite auto_exclude=false and a matching include pattern", file.Name)
		}
	}
}

func TestAddContextFileRefusesArchiveEntries(t *testing.T) {
	var zipBuf bytes.Buffer
	zw := zip.NewWriter(&zipBuf)
	var textBuf bytes.Buffer
	textWriter := bufio.NewWriter(&textBuf)
	manifest := &domain.ContextManifest{}
	var bundleBytes, contextBytes int64
	err := addContextFile(zw, textWriter, manifest, io.Discard, "patches/whx_bundle_res_abc_req_1.zip", []byte("PK\x03\x04"), 0o644, 1024, &bundleBytes, &contextBytes)
	if err == nil {
		t.Fatal("expected addContextFile to refuse an archive entry, got nil error")
	}
}

func TestAutoExcludeRemovesCommonGeneratedArtifacts(t *testing.T) {
	if reason, ignored := autoExclude(".idea", true); !ignored || reason == "" {
		t.Fatal(".idea should be auto-excluded")
	}
	if reason, ignored := autoExclude("coverage/report.log", false); !ignored || reason == "" {
		t.Fatal("log output should be auto-excluded")
	}
	if matchConfiguredPattern("src/pkg/main.go", "src/**") != true {
		t.Fatal("globstar include should match descendants")
	}
}

func TestAutoExcludeRemovesMobileToolchainsAndFrameworkCaches(t *testing.T) {
	for _, dir := range []string{".android-sdk", ".cxx", ".expo", ".metro-cache", ".npm-cache", "DerivedData", ".nuxt", ".svelte-kit", ".terragrunt-cache"} {
		if reason, ignored := autoExclude("services/mobile/"+dir, true); !ignored || reason == "" {
			t.Fatalf("%s should be auto-excluded", dir)
		}
	}
	for _, file := range []string{"dist/app-release.apk", "public/app.js.map", "build/classes.dex"} {
		if reason, ignored := autoExclude(file, false); !ignored || reason == "" {
			t.Fatalf("%s should be auto-excluded", file)
		}
	}
}

func TestIncludeOverrideRestoresOneHeuristicPathWithoutNarrowingProject(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, "src", "main.go"), "package main\n")
	mustWrite(t, filepath.Join(root, ".expo", "important.txt"), "keep me\n")
	mustWrite(t, filepath.Join(root, ".expo", "cache.txt"), "drop me\n")
	mustWrite(t, filepath.Join(root, "whaness.yml"), `version: 1
project:
  name: "override"
context:
  auto_exclude: true
  max_file_bytes: 2097152
  include: []
  include_overrides:
    - ".expo/important.txt"
  exclude: []
`)
	bundle, err := NewBuilder(1024*1024, 1024*1024).Build(root)
	if err != nil {
		t.Fatal(err)
	}
	names := zipNames(t, bundle.ZipPath)
	if !names["src/main.go"] || !names[".expo/important.txt"] || names[".expo/cache.txt"] {
		t.Fatalf("unexpected override context files: %#v", names)
	}
}

func TestIncludeOverrideCannotRestoreBinaryContent(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, "payload.dat"), string([]byte{0x00, 0x01, 0x02, 0x03}))
	mustWrite(t, filepath.Join(root, "whaness.yml"), `version: 1
project:
  name: "binary-override"
context:
  auto_exclude: true
  max_file_bytes: 2097152
  include: []
  include_overrides:
    - "payload.dat"
  exclude: []
`)
	bundle, err := NewBuilder(1024*1024, 1024*1024).Build(root)
	if err != nil {
		t.Fatal(err)
	}
	if zipNames(t, bundle.ZipPath)["payload.dat"] {
		t.Fatal("explicit UI override must not restore binary content")
	}
	seen := false
	for _, item := range bundle.Manifest.ExcludedDetails {
		if item.Path == "payload.dat" && item.Rule == "binary-content" {
			seen = true
		}
	}
	if !seen {
		t.Fatalf("binary exclusion should remain visible: %#v", bundle.Manifest.ExcludedDetails)
	}
}

func zipNames(t *testing.T, path string) map[string]bool {
	t.Helper()
	zr, err := zip.OpenReader(path)
	if err != nil {
		t.Fatal(err)
	}
	defer zr.Close()
	names := make(map[string]bool, len(zr.File))
	for _, file := range zr.File {
		names[file.Name] = true
	}
	return names
}

func TestBuildRecordsStructuredExclusionDetails(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, "main.go"), "package main\n")
	mustWrite(t, filepath.Join(root, ".env"), "TOKEN=secret\n")
	bundle, err := NewBuilder(1024*1024, 1024*1024).Build(root)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, item := range bundle.Manifest.ExcludedDetails {
		if item.Path == ".env" && item.Rule == "mandatory" {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected structured .env exclusion, got %#v", bundle.Manifest.ExcludedDetails)
	}
}

func TestContextInspectionShowsRootsRulesAndFinalInventory(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, "src", "main.go"), "package main\n")
	mustWrite(t, filepath.Join(root, "node_modules", "pkg", "index.js"), "module.exports = {}\n")
	mustWrite(t, filepath.Join(root, "README.md"), "# demo\n")
	builder := NewBuilder(1024*1024, 1024*1024)
	bundle, err := builder.Build(root)
	if err != nil {
		t.Fatal(err)
	}
	inspection, err := builder.Inspect(root, bundle.Manifest)
	if err != nil {
		t.Fatal(err)
	}
	if inspection.IncludedFiles < 2 || len(inspection.Rules) == 0 || len(inspection.Roots) < 3 {
		t.Fatalf("unexpected inspection: %#v", inspection)
	}
	seenIncluded, seenExcludedRoot := false, false
	for _, item := range inspection.Entries {
		if item.Path == "src/main.go" && item.Status == "included" {
			if item.ModifiedAt == nil || !item.Configurable {
				t.Fatalf("included file should expose sortable metadata and configuration action: %#v", item)
			}
			seenIncluded = true
		}
	}
	for _, item := range inspection.Roots {
		if item.Path == "node_modules" && item.Status == "excluded" {
			seenExcludedRoot = true
		}
	}
	if !seenIncluded || !seenExcludedRoot {
		t.Fatalf("inspection does not explain final context: %#v", inspection)
	}
	payload, err := json.Marshal(inspection)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(payload), `"patterns":null`) || strings.Contains(string(payload), `"entries":null`) || strings.Contains(string(payload), `"roots":null`) {
		t.Fatalf("inspection must serialize empty collections as arrays: %s", payload)
	}
}

func TestBuildExportsGitStatusAndWorktreeMetadata(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not installed")
	}
	root := t.TempDir()
	cmd := exec.Command("git", "init", "-q")
	cmd.Dir = root
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git init: %v: %s", err, out)
	}
	mustWrite(t, filepath.Join(root, "tracked.txt"), "one\n")
	cmd = exec.Command("git", "add", "tracked.txt")
	cmd.Dir = root
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git add: %v: %s", err, out)
	}
	mustWrite(t, filepath.Join(root, "untracked.txt"), "two\n")

	bundle, err := NewBuilder(1024*1024, 1024*1024).Build(root)
	if err != nil {
		t.Fatal(err)
	}
	zr, err := zip.OpenReader(bundle.ZipPath)
	if err != nil {
		t.Fatal(err)
	}
	defer zr.Close()
	var exports string
	for _, file := range zr.File {
		if file.Name != "EXPORTS.md" {
			continue
		}
		r, err := file.Open()
		if err != nil {
			t.Fatal(err)
		}
		data, err := io.ReadAll(r)
		_ = r.Close()
		if err != nil {
			t.Fatal(err)
		}
		exports = string(data)
	}
	if !strings.Contains(exports, "## Git status") || !strings.Contains(exports, "untracked.txt") || !strings.Contains(exports, "## Git worktrees") {
		t.Fatalf("unexpected EXPORTS.md:\n%s", exports)
	}
}

func TestContextFingerprintChangesWhenGitWorktreeTopologyChanges(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not installed")
	}
	root := t.TempDir()
	cmds := [][]string{
		{"git", "init", "-q"},
		{"git", "config", "user.email", "test@example.invalid"},
		{"git", "config", "user.name", "Wharness Test"},
	}
	for _, argv := range cmds {
		cmd := exec.Command(argv[0], argv[1:]...)
		cmd.Dir = root
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("%v: %v: %s", argv, err, out)
		}
	}
	mustWrite(t, filepath.Join(root, "main.go"), "package main\n")
	for _, args := range [][]string{{"add", "main.go"}, {"commit", "-qm", "initial"}} {
		cmd := exec.Command("git", args...)
		cmd.Dir = root
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v: %s", args, err, out)
		}
	}
	builder := NewBuilder(1024*1024, 1024*1024)
	before, err := builder.Build(root)
	if err != nil {
		t.Fatal(err)
	}
	worktree := filepath.Join(t.TempDir(), "analysis-worktree")
	cmd := exec.Command("git", "worktree", "add", "-q", "-b", "analysis-worktree", worktree)
	cmd.Dir = root
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git worktree add: %v: %s", err, out)
	}
	defer func() {
		cleanup := exec.Command("git", "worktree", "remove", "--force", worktree)
		cleanup.Dir = root
		_ = cleanup.Run()
	}()
	after, err := builder.Build(root)
	if err != nil {
		t.Fatal(err)
	}
	if before.Manifest.SHA256 == after.Manifest.SHA256 {
		t.Fatal("context fingerprint must change when git worktree topology changes")
	}
}

func TestContextFingerprintIsStableWithoutProjectChanges(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, "main.go"), "package main\n")
	builder := NewBuilder(1024*1024, 1024*1024)
	first, err := builder.Build(root)
	if err != nil {
		t.Fatal(err)
	}
	second, err := builder.Build(root)
	if err != nil {
		t.Fatal(err)
	}
	if first.Manifest.SHA256 != second.Manifest.SHA256 {
		t.Fatalf("unchanged project baseline is unstable: %s != %s", first.Manifest.SHA256, second.Manifest.SHA256)
	}
}

// Text is deflated and non-text is stored. The original contract was "no
// recompression" and that half is preserved: deflating an already-compressed
// payload spends CPU to gain nothing. Source text has never been compressed
// before, and storing it made the context ZIP the raw byte sum of the project —
// 21 MB for one 2,487-file project, whose upload ChatGPT timed out on four
// times before succeeding.
func TestContextSnapshotDeflatesTextAndStoresOpaqueContent(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "large.txt"), bytes.Repeat([]byte("context-line\n"), 4096), 0o600); err != nil {
		t.Fatal(err)
	}
	// Included via the project's include list, so the binary check does not
	// drop it before the archive is written.
	mustWrite(t, filepath.Join(root, "whaness.yml"), "version: 1\ncontext:\n  auto_exclude: false\n  max_file_bytes: 2097152\n  include: []\n  exclude: []\n")
	opaque := []byte{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02, 0x03}
	if err := os.WriteFile(filepath.Join(root, "logo.png"), bytes.Repeat(opaque, 512), 0o600); err != nil {
		t.Fatal(err)
	}
	bundle, err := NewBuilder(1<<20, 8<<20).Build(root)
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(filepath.Dir(bundle.ZipPath))
	archive, err := zip.OpenReader(bundle.ZipPath)
	if err != nil {
		t.Fatal(err)
	}
	defer archive.Close()
	methods := map[string]uint16{}
	var storedText uint64
	for _, entry := range archive.File {
		methods[entry.Name] = entry.Method
		if entry.Name == "large.txt" {
			storedText = entry.CompressedSize64
		}
	}
	if methods["large.txt"] != zip.Deflate {
		t.Fatalf("source text must be deflated, got ZIP method %d", methods["large.txt"])
	}
	if storedText == 0 || storedText >= 4096*13/2 {
		t.Fatalf("deflating highly repetitive text saved nothing: %d compressed bytes", storedText)
	}
	if method, ok := methods["logo.png"]; ok && method != zip.Store {
		t.Fatalf("opaque content must not be recompressed, got ZIP method %d", method)
	}
}

// A pnpm project configured with a repository-local store put 14,468
// content-addressed dependency blobs into one project's context. The manifest
// alone reached 5.8 MiB — six times what the Desktop can hand ChatGPT — so no
// prompt in that project could be delivered at all. These are dependency
// payloads under a different directory name, exactly like node_modules.
func TestDependencyStoresAreExcludedFromContext(t *testing.T) {
	for _, dir := range []string{
		".pnpm-store", ".pnpm", ".yarn-cache", ".turbo", ".parcel-cache",
		"__pycache__", ".venv", ".tox", ".mypy_cache", ".pytest_cache",
		"node_modules",
	} {
		if !ShouldIgnore(dir, true) {
			t.Fatalf("%s must be excluded from context bundles", dir)
		}
		if !ShouldIgnore("services/app/"+dir, true) {
			t.Fatalf("a nested %s must be excluded too", dir)
		}
	}
	// Ordinary source must remain eligible: over-pruning hides the code the
	// request is actually about.
	for _, path := range []string{"services/app/src/main.ts", "internal/app/service.go", "docs/venv-setup.md"} {
		if ShouldIgnore(path, false) {
			t.Fatalf("%s must stay in context", path)
		}
	}
}

// Generated reports, IDE metadata and build caches are not project source, and
// carrying them cost one project 1.8 MB of every request. AGENTS.md already
// asked for both classes to be pruned; they were simply never named.
func TestGeneratedAndIDEArtefactsAreExcludedFromContext(t *testing.T) {
	for _, dir := range []string{".idea", ".vscode", "playwright-report", "test-results", ".nyc_output"} {
		if !ShouldIgnore(dir, true) {
			t.Fatalf("%s must be excluded from context bundles", dir)
		}
		if !ShouldIgnore("services/flowcore-app/"+dir, true) {
			t.Fatalf("a nested %s must be excluded too", dir)
		}
	}
	for _, file := range []string{"tsconfig.app.tsbuildinfo", "services/app/lcov.lcov"} {
		if !ShouldIgnore(file, false) {
			t.Fatalf("%s must be excluded from context bundles", file)
		}
	}
	// SQL migrations are project source and MUST stay: this list cannot be
	// reopened by project configuration, so over-pruning here is unrecoverable.
	for _, file := range []string{"services/flowcore-migration/001_init.sql", "db/migrations/0002_add_index.sql"} {
		if ShouldIgnore(file, false) {
			t.Fatalf("%s is project source and must stay in context", file)
		}
	}
}
