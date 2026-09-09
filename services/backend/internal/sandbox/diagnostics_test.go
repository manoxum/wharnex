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
