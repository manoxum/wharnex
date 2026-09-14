package changeset

import (
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/domain"
)

// TestPrepareMergesFileWithTwoConflictingHunks is the regression for the Apply
// that failed with `merge <path>: exit status 2`. `git merge-file` returns the
// number of conflicts, so a file with two of them exited 2, which the old
// reader treated as a crash of the merge tool rather than as a conflict. Every
// candidate touching such a file failed the whole host Apply.
func TestPrepareMergesFileWithTwoConflictingHunks(t *testing.T) {
	// Two long single-line edits, each disjoint inside the line: the host
	// appended a prop, the plan changed an existing prop's signature. This is
	// the ordinary shape of a JSX prop list and collides only at line
	// granularity.
	base := "header\n" +
		"  const chrome = <Chrome onActivate={a} onUnbind={() => unbind()} onBind={b} />\n" +
		"middle\n" +
		"  onUnbind: () => void; onBind: () => void; onNewWindow: () => void\n" +
		"footer\n"
	host := "header\n" +
		"  const chrome = <Chrome onActivate={a} onUnbind={() => unbind()} onBind={b} onBindPath={p} />\n" +
		"middle\n" +
		"  onUnbind: () => void; onBind: () => void; onBindPath: (p: string) => void; onNewWindow: () => void\n" +
		"footer\n"
	result := "header\n" +
		"  const chrome = <Chrome onActivate={a} onUnbind={(path) => unbind(path)} onBind={b} />\n" +
		"middle\n" +
		"  onUnbind: (p: string) => void; onBind: () => void; onNewWindow: () => void\n" +
		"footer\n"

	root := t.TempDir()
	writeTestFile(t, root, "shell.tsx", host)
	prepared, err := Prepare(root, []domain.ChangeSet{{ID: "cs-1", Mutations: []domain.FileMutation{{
		Path: "shell.tsx", BaseExists: true, ResultExists: true,
		BaseContent: base, ResultContent: result,
	}}}})
	if err != nil {
		t.Fatalf("two conflicting hunks reported as a merge failure: %v", err)
	}
	if prepared.Outcome != domain.IntegrationReady {
		t.Fatalf("outcome=%s conflicts=%#v", prepared.Outcome, prepared.Conflicts)
	}
	if len(prepared.Writes) != 1 {
		t.Fatalf("writes=%d", len(prepared.Writes))
	}
	merged := string(prepared.Writes[0].Content)
	for _, want := range []string{"onBindPath={p}", "onUnbind={(path) => unbind(path)}", "onBindPath: (p: string) => void", "onUnbind: (p: string) => void"} {
		if !strings.Contains(merged, want) {
			t.Fatalf("merged content lost %q:\n%s", want, merged)
		}
	}
	if strings.Contains(merged, "<<<<<<<") || strings.Contains(merged, ">>>>>>>") {
		t.Fatalf("merged content kept conflict markers:\n%s", merged)
	}
	if len(prepared.Reconciliations) != 1 || prepared.Reconciliations[0].Tier != MergeTierToken {
		t.Fatalf("missing token-tier evidence: %#v", prepared.Reconciliations)
	}
	if prepared.Reconciliations[0].TokenResolved != 2 {
		t.Fatalf("token tier resolved %d of %d hunks", prepared.Reconciliations[0].TokenResolved, prepared.Reconciliations[0].Hunks)
	}
}

// A collision where both sides rewrote the same tokens has no mechanical
// answer. The ladder must stop rather than pick one, and must say the conflict
// is semantic so escalation spends its round where a round can help.
func TestPrepareKeepsGenuineTokenOverlapAsSemanticConflict(t *testing.T) {
	root := t.TempDir()
	writeTestFile(t, root, "file.txt", "value = hostValue\n")
	prepared, err := Prepare(root, []domain.ChangeSet{{ID: "cs-1", Mutations: []domain.FileMutation{{
		Path: "file.txt", BaseExists: true, ResultExists: true,
		BaseContent: "value = baseValue\n", ResultContent: "value = planValue\n",
	}}}})
	if err != nil {
		t.Fatal(err)
	}
	if prepared.Outcome != domain.IntegrationConflict || len(prepared.Conflicts) != 1 {
		t.Fatalf("expected one conflict, got %#v", prepared)
	}
	conflict := prepared.Conflicts[0]
	if conflict.Complexity != domain.ConflictComplexitySemantic {
		t.Fatalf("complexity=%q", conflict.Complexity)
	}
	if conflict.Hunks != 1 || conflict.ResolvedHunks != 0 {
		t.Fatalf("hunk evidence hunks=%d resolved=%d", conflict.Hunks, conflict.ResolvedHunks)
	}
}

// The token tier must never reach past the hunk the line tier conflicted on:
// everything outside a conflict comes from the line merge verbatim.
func TestTokenTierOnlyRewritesConflictingHunks(t *testing.T) {
	base := "alpha\nshared = one two\nomega\n"
	host := "ALPHA\nshared = ONE two\nomega\n"
	result := "alpha\nshared = one TWO\nOMEGA\n"

	root := t.TempDir()
	writeTestFile(t, root, "file.txt", host)
	prepared, err := Prepare(root, []domain.ChangeSet{{ID: "cs-1", Mutations: []domain.FileMutation{{
		Path: "file.txt", BaseExists: true, ResultExists: true,
		BaseContent: base, ResultContent: result,
	}}}})
	if err != nil {
		t.Fatal(err)
	}
	if prepared.Outcome != domain.IntegrationReady {
		t.Fatalf("outcome=%s conflicts=%#v", prepared.Outcome, prepared.Conflicts)
	}
	if got := string(prepared.Writes[0].Content); got != "ALPHA\nshared = ONE TWO\nOMEGA\n" {
		t.Fatalf("merged=%q", got)
	}
}

func TestTokenizeRoundTripsArbitraryText(t *testing.T) {
	for _, sample := range []string{
		"",
		"plain ascii\n",
		"crlf\r\nline\r\n",
		"no trailing newline",
		"back\\slash and \\n literal\n",
		"acentuação e emoji 🚀\n",
		"<<<<<<< not a marker\n=======\n>>>>>>> still not\n",
	} {
		back, ok := detokenize(tokenize([]byte(sample)))
		if !ok {
			t.Fatalf("detokenize refused round trip for %q", sample)
		}
		if string(back) != sample {
			t.Fatalf("round trip %q -> %q", sample, string(back))
		}
	}
}

// Content that looks like conflict output must not be parsed as conflict
// output. The marker width is raised above anything the inputs contain, and
// when that is impossible the file stays a conflict instead of being merged
// from a misread.
func TestMergeLadderIsNotFooledByMarkerLikeContent(t *testing.T) {
	base := "<<<<<<< documentation of markers\nbody\n=======\ntail\n"
	host := "<<<<<<< documentation of markers\nHOST\n=======\ntail\n"
	result := "<<<<<<< documentation of markers\nPLAN\n=======\ntail\n"

	merged, clean, report, err := mergeTextLadder([]byte(host), []byte(base), []byte(result))
	if err != nil {
		t.Fatal(err)
	}
	if clean {
		t.Fatalf("marker-like content merged silently into %q (tier %s)", string(merged), report.Tier)
	}
	if report.Tier != MergeTierUnresolved {
		t.Fatalf("tier=%s", report.Tier)
	}
}

func TestRunMergeFileReportsConflictCountNotFailure(t *testing.T) {
	base := "a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk\nl\nm\nz\no\np\n"
	host := strings.Replace(strings.Replace(base, "b\n", "HOST-B\n", 1), "z\n", "HOST-Z\n", 1)
	result := strings.Replace(strings.Replace(base, "b\n", "PLAN-B\n", 1), "z\n", "PLAN-Z\n", 1)

	_, code, err := runMergeFile([]byte(host), []byte(base), []byte(result))
	if err != nil {
		t.Fatalf("two conflicts surfaced as an error: %v", err)
	}
	if code != 2 {
		t.Fatalf("conflict count=%d, want 2", code)
	}
}
