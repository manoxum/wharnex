package app

import (
	"fmt"
	"regexp"
	"sort"
	"strings"

	"kernl.local/harness/backend/internal/domain"
)

// Attributing a verification failure to the change that caused it.
//
// A verification command is usually a whole suite — `go test ./...` runs every
// package in one exit code — so "did this command fail?" is far too coarse a
// question to decide whether the candidate broke anything. The baseline run
// answers the precise question instead: which individual failures are new?
//
// Getting this wrong is expensive in a specific, observed way. A repository
// whose `go test ./...` already failed for an unrelated reason handed that
// failure to the planner as though the candidate had caused it; the planner
// then patched unrelated production code to satisfy it, which in one measured
// run meant reverting a completed rename to make a stale test assertion pass.
// A failure the candidate did not introduce is never the candidate's to fix.

var (
	// `--- FAIL: TestName (0.04s)`, including subtests (`TestA/case_b`).
	goTestFailurePattern = regexp.MustCompile(`(?m)^\s*--- FAIL: (\S+)`)
	// `FAIL\tpackage/path\t0.000s`, and the build-failure form with no timing.
	//
	// The separator is horizontal whitespace only. `\s` spans newlines, so a
	// bare `FAIL` summary line would swallow the following line and capture the
	// word `FAIL` as though it were a package name, hiding the real one.
	goPackageFailurePattern = regexp.MustCompile(`(?m)^FAIL[ \t]+(\S+)`)
	typescriptDiagnostic    = regexp.MustCompile(`(?m)^(.+?)\(\d+,\d+\):\s+error\s+(TS\d+):\s+(.+?)\s*$`)
)

// failureFingerprints extracts the individual failures a verification command
// reported, in whichever diagnostic family it speaks.
//
// Only families with a stable machine-readable shape are parsed. Returning
// nothing is the honest answer for a command whose output we cannot decompose,
// and it keeps the caller on the strict whole-output comparison rather than
// letting a guess decide whether a candidate regressed.
func failureFingerprints(result domain.CommandResult) map[string]string {
	combined := strings.ReplaceAll(result.Stdout+"\n"+result.Stderr, "\r\n", "\n")
	out := map[string]string{}
	for _, match := range typescriptDiagnostic.FindAllStringSubmatch(combined, -1) {
		path := strings.TrimSpace(strings.ReplaceAll(match[1], "\\", "/"))
		message := strings.Join(strings.Fields(match[3]), " ")
		key := "ts|" + path + "|" + strings.TrimSpace(match[2]) + "|" + message
		out[key] = fmt.Sprintf("%s: %s %s", path, strings.TrimSpace(match[2]), message)
	}
	for _, match := range goTestFailurePattern.FindAllStringSubmatch(combined, -1) {
		name := strings.TrimSpace(match[1])
		out["go-test|"+name] = "failing test " + name
	}
	// A package that fails to build reports no `--- FAIL` line at all, so
	// without this an unbuildable package would look like no failure whatsoever
	// and a real regression would be waved through as "unchanged".
	for _, match := range goPackageFailurePattern.FindAllStringSubmatch(combined, -1) {
		pkg := strings.TrimSpace(match[1])
		if pkg == "" {
			continue
		}
		out["go-package|"+pkg] = "failing package " + pkg
	}
	return out
}

// newVerificationFailures returns the failures present after the patch that the
// unmodified baseline did not already report, in stable order.
func newVerificationFailures(baseline, post domain.CommandResult) []string {
	baselineFailures := failureFingerprints(baseline)
	postFailures := failureFingerprints(post)
	if len(postFailures) == 0 {
		return nil
	}
	introduced := make([]string, 0, len(postFailures))
	for key, description := range postFailures {
		if _, existed := baselineFailures[key]; !existed {
			introduced = append(introduced, description)
		}
	}
	sort.Strings(introduced)
	return introduced
}

// preExistingVerificationFailures returns the failures both runs share.
func preExistingVerificationFailures(baseline, post domain.CommandResult) []string {
	baselineFailures := failureFingerprints(baseline)
	shared := make([]string, 0, len(baselineFailures))
	for key, description := range failureFingerprints(post) {
		if _, existed := baselineFailures[key]; existed {
			shared = append(shared, description)
		}
	}
	sort.Strings(shared)
	return shared
}

// verificationFailureEquivalent reports whether the patch introduced nothing the
// baseline did not already fail on.
//
// The strict whole-output comparison comes first and is preserved exactly: when
// the two runs say the same thing there is nothing to decompose. Only when they
// differ does the structured comparison decide, and only on the strength of
// failures it actually parsed — an output we cannot decompose is treated as a
// regression, never waved through.
func verificationFailureEquivalent(baseline, post domain.CommandResult) bool {
	if normalizedVerificationOutput(baseline) == normalizedVerificationOutput(post) {
		return true
	}
	baselineFailures := failureFingerprints(baseline)
	postFailures := failureFingerprints(post)
	if len(baselineFailures) == 0 || len(postFailures) == 0 {
		return false
	}
	return len(newVerificationFailures(baseline, post)) == 0
}

// describeVerificationAttribution renders the sentence the repair round is
// actually steered by.
//
// It exists because the raw suite output is not a usable instruction: it lists
// every failure the command produced, and the planner has no way to tell which
// of them its own patch caused. Naming the pre-existing ones explicitly, and
// saying they must not be fixed, is what stops a repair round from wandering
// into unrelated production code to silence a failure it did not cause.
func describeVerificationAttribution(baseline, post domain.CommandResult) string {
	introduced := newVerificationFailures(baseline, post)
	preExisting := preExistingVerificationFailures(baseline, post)
	if len(introduced) == 0 && len(preExisting) == 0 {
		return ""
	}
	var out strings.Builder
	if len(introduced) > 0 {
		out.WriteString("Introduced by this change (fix these): ")
		out.WriteString(strings.Join(introduced, "; "))
	}
	if len(preExisting) > 0 {
		if out.Len() > 0 {
			out.WriteString("\n")
		}
		out.WriteString("Already failing on the unmodified baseline (NOT caused by this change; do NOT modify code to satisfy them): ")
		out.WriteString(strings.Join(preExisting, "; "))
	}
	return out.String()
}
