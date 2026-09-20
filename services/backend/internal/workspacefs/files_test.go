package workspacefs

import (
	"os"
	"path/filepath"
	"testing"
)

func TestReadWriteAndConflict(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "src", "hello.txt")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("old\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	current, err := Read(root, "src/hello.txt")
	if err != nil {
		t.Fatal(err)
	}
	saved, err := Write(root, "src/hello.txt", "new\n", current.SHA256)
	if err != nil {
		t.Fatal(err)
	}
	if saved.Content != "new\n" {
		t.Fatalf("content=%q", saved.Content)
	}
	if _, err := Write(root, "src/hello.txt", "stale\n", current.SHA256); err == nil {
		t.Fatal("expected optimistic-lock conflict")
	}
}

func TestTraversalAndEnvironmentCreationDenied(t *testing.T) {
	root := t.TempDir()
	if _, err := Write(root, "../escape.txt", "x", ""); err == nil {
		t.Fatal("expected traversal rejection")
	}
	if _, err := Write(root, ".env", "TOKEN=x", ""); err == nil {
		t.Fatal("expected environment-file creation rejection")
	}
}

func TestEditorListsReadsAndUpdatesExistingEnvironmentFiles(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, ".harnessignore"), []byte(".env\n*.env\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	for name, content := range map[string]string{
		".env":       "TOKEN=one\n",
		".env.main":  "MODE=main\n",
		"config.env": "PORT=8080\n",
	} {
		if err := os.WriteFile(filepath.Join(root, name), []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
	}

	entries, err := List(root)
	if err != nil {
		t.Fatal(err)
	}
	paths := map[string]bool{}
	for _, entry := range entries {
		paths[entry.Path] = true
	}
	for _, name := range []string{".env", ".env.main", "config.env"} {
		if !paths[name] {
			t.Fatalf("expected %s in editor listing: %#v", name, entries)
		}
	}

	current, err := Read(root, ".env.main")
	if err != nil {
		t.Fatal(err)
	}
	saved, err := Write(root, ".env.main", "MODE=updated\n", current.SHA256)
	if err != nil {
		t.Fatal(err)
	}
	if saved.Content != "MODE=updated\n" {
		t.Fatalf("content=%q", saved.Content)
	}
	if _, err := Write(root, ".env.missing", "TOKEN=x\n", ""); err == nil {
		t.Fatal("expected a new environment file to stay protected")
	}
	if _, _, err := OpenPreview(root, ".env"); err == nil {
		t.Fatal("expected environment files to stay unavailable through preview")
	}
}

func TestOpenPreviewStreamsBinaryAndKeepsContainment(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "sample.pdf"), []byte("%PDF-binary\x00"), 0o600); err != nil {
		t.Fatal(err)
	}
	handle, info, err := OpenPreview(root, "sample.pdf")
	if err != nil {
		t.Fatal(err)
	}
	defer handle.Close()
	if info.Size() != 12 {
		t.Fatalf("size=%d", info.Size())
	}
	if _, _, err := OpenPreview(root, "../sample.pdf"); err == nil {
		t.Fatal("expected traversal rejection")
	}
}

func TestListOmitsIgnored(t *testing.T) {
	root := t.TempDir()
	_ = os.MkdirAll(filepath.Join(root, "node_modules", "x"), 0o755)
	_ = os.WriteFile(filepath.Join(root, "node_modules", "x", "a.js"), []byte("x"), 0o600)
	_ = os.WriteFile(filepath.Join(root, "main.go"), []byte("package main\n"), 0o600)
	entries, err := List(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Path != "main.go" {
		t.Fatalf("entries=%#v", entries)
	}
}

func TestWriteRejectsSymlinkParentEscape(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	if err := os.Symlink(outside, filepath.Join(root, "link")); err != nil {
		t.Fatal(err)
	}
	if _, err := Write(root, "link/escape.txt", "x", ""); err == nil {
		t.Fatal("expected symlink-parent rejection")
	}
	if _, err := os.Stat(filepath.Join(outside, "escape.txt")); !os.IsNotExist(err) {
		t.Fatal("outside file must not be created")
	}
}

func TestWriteRejectsSymlinkFile(t *testing.T) {
	root := t.TempDir()
	outside := filepath.Join(t.TempDir(), "outside.txt")
	if err := os.WriteFile(outside, []byte("secret"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "link.txt")); err != nil {
		t.Fatal(err)
	}
	if _, err := Write(root, "link.txt", "overwrite", ""); err == nil {
		t.Fatal("expected symlink-file rejection")
	}
	data, _ := os.ReadFile(outside)
	if string(data) != "secret" {
		t.Fatal("outside file must remain unchanged")
	}
}

func TestWritePreservesExecutableMode(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "script.sh")
	if err := os.WriteFile(path, []byte("#!/bin/sh\necho old\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	current, err := Read(root, "script.sh")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := Write(root, "script.sh", "#!/bin/sh\necho new\n", current.SHA256); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o755 {
		t.Fatalf("mode changed to %o", info.Mode().Perm())
	}
}

func TestWorkspaceMutations(t *testing.T) {
	root := t.TempDir()
	if err := CreateDirectory(root, "src"); err != nil {
		t.Fatal(err)
	}
	created, err := CreateFile(root, "src/new.txt")
	if err != nil {
		t.Fatal(err)
	}
	if created.Path != "src/new.txt" {
		t.Fatalf("created path=%q", created.Path)
	}
	if err := Rename(root, "src/new.txt", "src/renamed.txt"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "src", "renamed.txt")); err != nil {
		t.Fatal(err)
	}
	if err := Delete(root, "src"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "src")); !os.IsNotExist(err) {
		t.Fatalf("expected directory to be removed, err=%v", err)
	}
}

func TestWorkspaceMutationsRejectExcludedAndTraversal(t *testing.T) {
	root := t.TempDir()
	if _, err := CreateFile(root, "../escape.txt"); err == nil {
		t.Fatal("expected traversal rejection")
	}
	if err := CreateDirectory(root, ".git"); err == nil {
		t.Fatal("expected protected directory rejection")
	}
	if _, err := CreateFile(root, ".env"); err == nil {
		t.Fatal("expected protected file rejection")
	}
}

func TestWorkspaceRenameRejectsSymlink(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	if err := os.Symlink(outside, filepath.Join(root, "link")); err != nil {
		t.Fatal(err)
	}
	if err := Rename(root, "link", "renamed"); err == nil {
		t.Fatal("expected symlink rename rejection")
	}
}

func TestSearchSupportsLiteralRegexCaseWholeWordAndFuzzyMatches(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "src"), 0o755); err != nil {
		t.Fatal(err)
	}
	content := "const DatabaseClient = connect()\nconst literal = 'a+b'\nconst database = 'small'\n"
	if err := os.WriteFile(filepath.Join(root, "src", "app.ts"), []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}

	literal, err := Search(root, SearchOptions{Query: "a+b"})
	if err != nil {
		t.Fatal(err)
	}
	if len(literal.Matches) != 1 || literal.Matches[0].Line != 2 {
		t.Fatalf("literal matches=%#v", literal.Matches)
	}

	caseSensitive, err := Search(root, SearchOptions{Query: "databaseclient", CaseSensitive: true})
	if err != nil {
		t.Fatal(err)
	}
	if len(caseSensitive.Matches) != 0 {
		t.Fatalf("case-sensitive matches=%#v", caseSensitive.Matches)
	}

	regex, err := Search(root, SearchOptions{Query: `Database\w+`, Regex: true})
	if err != nil {
		t.Fatal(err)
	}
	if len(regex.Matches) != 1 || regex.Matches[0].Column != 7 {
		t.Fatalf("regex matches=%#v", regex.Matches)
	}

	wholeWord, err := Search(root, SearchOptions{Query: "database", WholeWord: true})
	if err != nil {
		t.Fatal(err)
	}
	if len(wholeWord.Matches) != 1 || wholeWord.Matches[0].Line != 3 {
		t.Fatalf("whole-word matches=%#v", wholeWord.Matches)
	}

	fuzzy, err := Search(root, SearchOptions{Query: "DatabseClient", Fuzzy: true})
	if err != nil {
		t.Fatal(err)
	}
	if len(fuzzy.Matches) != 1 || fuzzy.Matches[0].Line != 1 {
		t.Fatalf("fuzzy matches=%#v", fuzzy.Matches)
	}

	if err := os.WriteFile(filepath.Join(root, "unicode.txt"), []byte("olá 😊 mundo\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	unicodeResult, err := Search(root, SearchOptions{Query: "mundo"})
	if err != nil {
		t.Fatal(err)
	}
	var unicodeMatch *SearchMatch
	for index := range unicodeResult.Matches {
		if unicodeResult.Matches[index].Path == "unicode.txt" {
			unicodeMatch = &unicodeResult.Matches[index]
			break
		}
	}
	if unicodeMatch == nil || unicodeMatch.Column != 8 {
		t.Fatalf("unicode match=%#v", unicodeMatch)
	}
}

func TestSearchHonorsResultLimit(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "many.txt"), []byte("needle\nneedle\nneedle\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	result, err := Search(root, SearchOptions{Query: "needle", Limit: 2})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Matches) != 2 || !result.Truncated {
		t.Fatalf("result=%#v", result)
	}
}
