package app

import (
	"errors"
	"testing"

	"kernl.local/harness/backend/internal/domain"
)

// A host build that failed reaching the module proxy says nothing about the
// candidate: the same bytes build once the network answers. Sending it to a
// planner spends a round rewriting the one thing that cannot be the cause.
func TestHostBuildNetworkFaultIsInfrastructureNotACandidateDefect(t *testing.T) {
	cause := errors.New(`self-evolution host build failed: exit status 2
[deps] backend: metadata changed or module cache incomplete; hydrating Go module cache
go: github.com/jackc/pgpassfile@v1.0.0: Get "https://proxy.golang.org/github.com/jackc/pgpassfile/@v/v1.0.0.mod": dial tcp: lookup proxy.golang.org on 127.0.0.11:53: server misbehaving
make: *** [Makefile:122: build-stage] Error 2`)
	if got := classifyExecutionFailure(cause); got != domain.FailureKindHostBuildDependencyNetwork {
		t.Fatalf("classifyExecutionFailure()=%q want %q", got, domain.FailureKindHostBuildDependencyNetwork)
	}
}

func TestDependencyNetworkDiagnosticRecognizesRealFetchFailures(t *testing.T) {
	for _, diagnostic := range []string{
		`go: golang.org/x/net@v0.1.0: Get "https://proxy.golang.org/...": dial tcp: i/o timeout`,
		"npm error network request to https://registry.npmjs.org/vite failed, reason: ECONNRESET",
		"[deps] backend: hydrating Go module cache\ngo: module lookup failed: no such host",
	} {
		if !isDependencyNetworkDiagnostic(diagnostic) {
			t.Fatalf("real dependency fetch failure not recognized: %q", diagnostic)
		}
	}
}

// The markers must not claim a project's own failure. A suite that exercises a
// refused connection is a source result, and retrying the Apply would only
// reproduce it while hiding a genuine regression behind an infrastructure
// label.
func TestDependencyNetworkDiagnosticIgnoresProjectOwnedNetworkFailures(t *testing.T) {
	for _, diagnostic := range []string{
		"--- FAIL: TestDialsUpstream\n    client_test.go:42: dial tcp 127.0.0.1:9999: connection refused",
		"self-evolution host build failed: exit status 1\nsrc/app.tsx(12,3): error TS2741: Property 'onBindPath' is missing",
		"make: *** [Makefile:168: frontend-check] Error 127",
	} {
		if isDependencyNetworkDiagnostic(diagnostic) {
			t.Fatalf("project-owned failure misread as a dependency network fault: %q", diagnostic)
		}
	}
}
