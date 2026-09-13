package sandbox

import "strings"

// This file recognizes sandbox failures whose cause is the machine, not the
// code under test. Both classes below were observed repairing themselves into
// an infinite AI loop in production: the planner was handed a "verification
// failed" error, wrote a source patch for a disk-full linker error or a
// missing binary, and the next round failed identically.

// resourceExhaustionMarkers are the kernel/runtime phrasings that mean the
// container ran out of a machine resource mid-command. They are matched
// case-insensitively against combined command output.
var resourceExhaustionMarkers = []string{
	"no space left on device",
	"cannot allocate memory",
	"out of memory",
	"signal: killed",
	"write /workspace: disk quota exceeded",
	"disk quota exceeded",
	"too many open files",
}

// IsResourceExhaustionDiagnostic reports whether command output indicates the
// sandbox exhausted disk, memory, or file descriptors. Such a failure is an
// infrastructure fault: it says nothing about whether the patch is correct,
// and no source change is its remedy.
func IsResourceExhaustionDiagnostic(text string) bool {
	if text == "" {
		return false
	}
	lower := strings.ToLower(text)
	for _, marker := range resourceExhaustionMarkers {
		if strings.Contains(lower, marker) {
			return true
		}
	}
	return false
}

// unsupportedToolchainMarkers are the phrasings a build driver uses when the
// environment it is running in cannot perform the requested build mode at all,
// however correct the source is. They are matched case-insensitively.
//
// Production evidence: `go test -race ./...` verified in the Protected runner
// (which installs build-essential) and then failed post-merge in 5 ms with
// "go: -race requires cgo; enable cgo by setting CGO_ENABLED=1", because the
// host verification environment had no C compiler. The exit status was 2 and
// no binary was missing, so neither existing classifier recognized it and the
// verified candidate was reverted into a repair round that could never succeed.
var unsupportedToolchainMarkers = []string{
	"requires cgo; enable cgo by setting cgo_enabled=1",
	"-race requires cgo",
	"-msan requires cgo",
	"-asan requires cgo",
	"-race is only supported on",
	"race detector not supported on",
	"cgo: c compiler",
	`c compiler "gcc" not found`,
	`c compiler "cc" not found`,
	`exec: "gcc": executable file not found`,
	`exec: "cc": executable file not found`,
	`exec: "clang": executable file not found`,
}

// IsUnsupportedToolchainDiagnostic reports whether command output proves the
// environment cannot run the command's build mode — cgo disabled, no C
// compiler, an instrumentation mode unavailable for this platform. Unlike a
// missing executable, the tool being invoked is installed; it is the
// capability behind it that is absent.
//
// This says nothing about whether the patch is correct. It is an environment
// measurement, so a source patch is never its remedy.
func IsUnsupportedToolchainDiagnostic(text string) bool {
	if text == "" {
		return false
	}
	lower := strings.ToLower(text)
	for _, marker := range unsupportedToolchainMarkers {
		if strings.Contains(lower, marker) {
			return true
		}
	}
	return false
}

// missingExecutableMarkers are how a missing binary surfaces through the
// runner's `exec` entrypoint and through the common language runtimes.
var missingExecutableMarkers = []string{
	": not found",
	"executable file not found",
	"command not found",
	"no such file or directory",
}

// IsMissingExecutableDiagnostic reports whether a command failed because the
// executable it names is not installed in the runner image. exitCode 127 is
// the shell/exec convention for this and is required alongside the textual
// marker, so an ordinary "no such file or directory" from a program's own
// argument handling is not misread as a missing tool.
//
// This is a *repairable* condition — unlike resource exhaustion, the planner
// genuinely can fix it by choosing an available tool — but only if it is told
// which tool was missing. The environment manifest publishes the installed
// inventory so it does not arise in the first place.
func IsMissingExecutableDiagnostic(exitCode int, text string) bool {
	if exitCode != 127 || text == "" {
		return false
	}
	lower := strings.ToLower(text)
	for _, marker := range missingExecutableMarkers {
		if strings.Contains(lower, marker) {
			return true
		}
	}
	return false
}
