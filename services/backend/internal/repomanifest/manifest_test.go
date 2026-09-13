package repomanifest

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func git(t *testing.T, dir string, args ...string) {
	t.Helper()
	base := []string{
		"-C", dir,
		"-c", "user.name=Tester", "-c", "user.email=test@example.invalid",
		"-c", "commit.gpgSign=false", "-c", "protocol.file.allow=always",
	}
	cmd := exec.Command("git", append(base, args...)...)
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v: %s", args, err, output)
	}
}

func newRepo(t *testing.T, fileName string) string {
	t.Helper()
	root := t.TempDir()
	git(t, root, "init", "-q", "-b", "main")
	if err := os.WriteFile(filepath.Join(root, fileName), []byte("x\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	git(t, root, "add", "-A")
	git(t, root, "commit", "-qm", "initial")
	return root
}

func requireGit(t *testing.T) {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is not installed")
	}
}

// An ordinary project renders nothing. A section stating that the project is
// one repository would spend context on what the planner already assumes, and
// would train planners to skim past the section in the case that matters.
func TestRenderIsEmptyForASingleRepositoryProject(t *testing.T) {
	requireGit(t)
	manifest := Measure(context.Background(), newRepo(t, "a.txt"))
	if manifest.HasSubmodules() {
		t.Fatalf("an ordinary project must measure as one unit: %+v", manifest.Units)
	}
	if manifest.Render() != "" {
		t.Fatalf("expected no section for a single-repository project, got %q", manifest.Render())
	}
}

func TestMeasureDescribesEveryUnit(t *testing.T) {
	requireGit(t)
	origin := newRepo(t, "lib.txt")
	root := newRepo(t, "README.md")
	git(t, root, "submodule", "add", "-q", "--", origin, "services/app")
	git(t, root, "commit", "-qm", "add submodule")

	manifest := Measure(context.Background(), root)
	if manifest.Schema != SchemaVersion || len(manifest.Units) != 2 {
		t.Fatalf("unexpected manifest: %+v", manifest)
	}
	if manifest.Units[0].Role != "superproject" || manifest.Units[0].Path != "" || !manifest.Units[0].Patchable {
		t.Fatalf("unexpected superproject entry: %+v", manifest.Units[0])
	}
	submodule := manifest.Units[1]
	if submodule.Role != "submodule" || submodule.Path != "services/app" || !submodule.Patchable || !submodule.Initialized {
		t.Fatalf("an initialized submodule must be described as patchable: %+v", submodule)
	}
	if submodule.RecordedCommit == "" || submodule.Head == "" {
		t.Fatalf("the unit must carry both the recorded pointer and its own HEAD: %+v", submodule)
	}

	section := manifest.Render()
	if !strings.Contains(section, SchemaVersion) || !strings.Contains(section, "services/app") {
		t.Fatalf("the section must name the schema and the units: %q", section)
	}
	// The planner must be told that it writes ordinary project-relative paths
	// and never selects a repository, or it invents a protocol field for one.
	if !strings.Contains(section, "project-relative paths") {
		t.Fatalf("the section must state the routing contract: %q", section)
	}
	// Remote URLs carry credentials often enough that publishing them is not
	// worth the marginal context, exactly as the project export already decided.
	if strings.Contains(section, origin) {
		t.Fatalf("the section must not publish repository URLs: %q", section)
	}
}

// A project Wharnex cannot inspect produces an empty manifest rather than an
// error: the section is valuable but never load bearing.
func TestMeasureDegradesForAnUnmeasurableProject(t *testing.T) {
	manifest := Measure(context.Background(), filepath.Join(t.TempDir(), "missing"))
	if len(manifest.Units) != 0 || manifest.Render() != "" {
		t.Fatalf("expected an empty manifest, got %+v", manifest)
	}
}
