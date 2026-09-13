package sandbox

import "testing"

// The exact linker output that failed a real production request and then
// consumed a repair round that could never succeed.
const observedDiskFullOutput = `--- FAIL: TestPreparedGoDependenciesSupportOfflineVerification (18.45s)
    copy_test.go:496: offline verification failed after hydration: exit status 1: # offline.example/check.test
        /usr/local/go/pkg/tool/linux_amd64/link: mapping output file failed: no space left on device
        FAIL	offline.example/check [build failed]`

func TestIsResourceExhaustionDiagnostic(t *testing.T) {
	for _, testCase := range []struct {
		name string
		text string
		want bool
	}{
		{"observed linker disk exhaustion", observedDiskFullOutput, true},
		{"container OOM kill", "signal: killed", true},
		{"allocation failure", "runtime: cannot allocate memory", true},
		{"descriptor exhaustion", "open /workspace/x: too many open files", true},
		{"ordinary assertion failure", "--- FAIL: TestThing\n  want 3, got 4", false},
		{"empty", "", false},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			if got := IsResourceExhaustionDiagnostic(testCase.text); got != testCase.want {
				t.Fatalf("IsResourceExhaustionDiagnostic = %t, want %t", got, testCase.want)
			}
		})
	}
}

func TestIsUnsupportedToolchainDiagnostic(t *testing.T) {
	for _, testCase := range []struct {
		name string
		text string
		want bool
	}{
		// The exact stderr of the production post-merge failure: the gate
		// passed in the runner image and died in 5 ms in the control container.
		{"observed cgo-less race build", "go: -race requires cgo; enable cgo by setting CGO_ENABLED=1", true},
		{"missing C compiler", `# runtime/cgo
exec: "gcc": executable file not found in $PATH`, true},
		{"unsupported race platform", "-race is only supported on linux/amd64, linux/ppc64le, ...", true},
		{"ordinary test failure", "--- FAIL: TestThing\n  want 3, got 4", false},
		{"ordinary build error", "./x.go:7:2: undefined: Foo", false},
		{"prose mentioning cgo", "// cgo is used by this package", false},
		{"empty", "", false},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			if got := IsUnsupportedToolchainDiagnostic(testCase.text); got != testCase.want {
				t.Fatalf("IsUnsupportedToolchainDiagnostic = %t, want %t", got, testCase.want)
			}
		})
	}
}

func TestIsMissingExecutableDiagnostic(t *testing.T) {
	// The exact runner entrypoint output for the `jq` plan that failed.
	observed := "/usr/local/bin/kernl-entrypoint: 3: exec: jq: not found\n"
	if !IsMissingExecutableDiagnostic(127, observed) {
		t.Fatal("the observed missing-executable output must be recognized")
	}
	// A program's own "no such file or directory" on a normal exit code is a
	// project error, not a missing tool, and must not be reclassified.
	if IsMissingExecutableDiagnostic(1, "open config.yaml: no such file or directory") {
		t.Fatal("a non-127 exit must never be treated as a missing executable")
	}
	if IsMissingExecutableDiagnostic(127, "") {
		t.Fatal("exit 127 with no diagnostic is not enough evidence")
	}
}
