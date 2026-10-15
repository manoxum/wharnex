package nodecontext

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/domain"
)

func TestNpmPeerCompatibilityCommandRecoversObservedEResolve(t *testing.T) {
	diagnostic := `npm error code ERESOLVE
npm error ERESOLVE could not resolve
npm error Could not resolve dependency:
npm error Conflicting peer dependency: graphql@15.10.3`
	want := []string{"npm", "ci", "--legacy-peer-deps"}
	if got := npmPeerCompatibilityCommand([]string{"npm", "ci"}, diagnostic); !reflect.DeepEqual(got, want) {
		t.Fatalf("compatibility command = %v, want %v", got, want)
	}
}

func TestNpmPeerCompatibilityCommandFailsClosedForOtherErrors(t *testing.T) {
	for name, diagnostic := range map[string]string{
		"stale lockfile": "npm error code EUSAGE\npackage.json and package-lock.json are not in sync",
		"install script": "npm error command failed\nnpm error lifecycle test failed",
		"network":        "npm error request failed with ECONNRESET",
	} {
		t.Run(name, func(t *testing.T) {
			if got := npmPeerCompatibilityCommand([]string{"npm", "ci"}, diagnostic); got != nil {
				t.Fatalf("unexpected compatibility fallback: %v", got)
			}
		})
	}
}

func TestNpmPeerCompatibilityCommandDoesNotAlterOtherPackageManagers(t *testing.T) {
	diagnostic := "ERESOLVE could not resolve peer dependency"
	if got := npmPeerCompatibilityCommand([]string{"pnpm", "install", "--frozen-lockfile"}, diagnostic); got != nil {
		t.Fatalf("unexpected pnpm fallback: %v", got)
	}
}

func TestNpmPeerCompatibilityCommandRetriesOnlyOnce(t *testing.T) {
	diagnostic := "ERESOLVE could not resolve peer dependency"
	if got := npmPeerCompatibilityCommand([]string{"npm", "ci", "--legacy-peer-deps"}, diagnostic); got != nil {
		t.Fatalf("compatibility fallback repeated: %v", got)
	}
}

func TestAcquirePreservesNpmFallbackAndNestedPnpmTarget(t *testing.T) {
	for _, scenario := range []struct {
		name, lockfile, cwd string
		command             []string
		installs            []string
	}{
		{"npm peer conflict", "package-lock.json", ".", []string{"npm", "run", "build"}, []string{"npm ci", "npm ci --legacy-peer-deps"}},
		{"nested pnpm", "services/app/pnpm-lock.yaml", "services/app", []string{"pnpm", "--dir", "services/app", "run", "build"}, []string{"pnpm install --frozen-lockfile"}},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			root, tools := t.TempDir(), t.TempDir()
			lockfile := filepath.Join(root, scenario.lockfile)
			if err := os.MkdirAll(filepath.Dir(lockfile), 0o755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(lockfile, []byte("fixture"), 0o600); err != nil {
				t.Fatal(err)
			}
			log := filepath.Join(tools, "calls")
			script := `#!/bin/sh
printf '%s\n' "$*" >> "$WHARNEX_TEST_DOCKER_LOG"
case "$*" in
  *" npm ci") printf '%s\n' 'ERESOLVE could not resolve peer dependency'; exit 1 ;;
esac
`
			if err := os.WriteFile(filepath.Join(tools, "docker"), []byte(script), 0o700); err != nil {
				t.Fatal(err)
			}
			t.Setenv("PATH", tools+string(os.PathListSeparator)+os.Getenv("PATH"))
			t.Setenv("WHARNEX_TEST_DOCKER_LOG", log)
			command := domain.CommandSpec{Cwd: ".", Argv: scenario.command}
			limits := Limits{Pids: 64, Memory: "512m", CPUs: "1", TmpfsSize: "64m"}
			if err := Acquire(t.Context(), root, "runner:test", command, limits, validateTestPath); err != nil {
				t.Fatal(err)
			}
			data, err := os.ReadFile(log)
			if err != nil {
				t.Fatal(err)
			}
			calls := strings.Split(strings.TrimSpace(string(data)), "\n")
			if len(calls) != len(scenario.installs) {
				t.Fatalf("acquisition attempts: %v", calls)
			}
			for i, call := range calls {
				cwd := "/workspace"
				if scenario.cwd != "." {
					cwd += "/" + scenario.cwd
				}
				if !strings.HasSuffix(call, "--workdir "+cwd+" runner:test "+scenario.installs[i]) {
					t.Fatalf("wrong acquisition target or install: %s", call)
				}
				for _, boundary := range []string{"--read-only", "--cap-drop ALL", "--security-opt no-new-privileges:true", "--volume " + root + ":/workspace:rw"} {
					if !strings.Contains(call, boundary) {
						t.Fatalf("missing sandbox boundary %q: %s", boundary, call)
					}
				}
			}
		})
	}
}
