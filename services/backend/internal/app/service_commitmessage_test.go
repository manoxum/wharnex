package app

import (
	"strings"
	"testing"
)

// The body is the reason a commit message is worth reading. Flattening it into
// the subject — which this used to do unconditionally — made every Wharnex
// commit a bare one-liner regardless of what the planner wrote.
func TestSanitizeCommitMessagePreservesTheBody(t *testing.T) {
	raw := "fix(auth): rotate the refresh token atomically\n" +
		"\n" +
		"Two refreshes racing on one session revoked the newer token.\n" +
		"\n" +
		"- swap atomically\n" +
		"- keep the loser's read consistent\n"
	got := sanitizeCommitMessage(raw, "")
	subject, body, found := strings.Cut(got, "\n\n")
	if !found {
		t.Fatalf("body was flattened into the subject: %q", got)
	}
	if subject != "fix(auth): rotate the refresh token atomically" {
		t.Fatalf("subject altered: %q", subject)
	}
	if !strings.Contains(body, "- swap atomically\n- keep the loser's read consistent") {
		t.Fatalf("body list structure lost: %q", body)
	}
}

func TestSanitizeCommitMessageCollapsesOnlyTheSubject(t *testing.T) {
	got := sanitizeCommitMessage("fix(auth):    rotate   tokens\n\nBody   keeps    its spacing.", "")
	if !strings.HasPrefix(got, "fix(auth): rotate tokens\n\n") {
		t.Fatalf("subject should be collapsed to single spaces: %q", got)
	}
	if !strings.Contains(got, "Body   keeps    its spacing.") {
		t.Fatalf("body spacing should be preserved verbatim: %q", got)
	}
}

func TestSanitizeCommitMessageStripsControlCharactersButKeepsStructure(t *testing.T) {
	got := sanitizeCommitMessage("fix(x): drop the \x00bell\x07 characters\n\nbody\x1bline", "")
	if strings.ContainsAny(got, "\x00\x07\x1b") {
		t.Fatalf("control characters survived: %q", got)
	}
	if !strings.Contains(got, "\n\nbody") {
		t.Fatalf("structure lost while stripping: %q", got)
	}
}

// The previous fallback emitted the exact subject the protocol names as a
// quality failure, so the one guaranteed code path produced a forbidden value.
func TestSanitizeCommitMessageFallbackIsNotAForbiddenSubject(t *testing.T) {
	got := sanitizeCommitMessage("", "")
	if strings.Contains(strings.ToLower(got), "wharness-verified change") {
		t.Fatalf("fallback still emits a protocol-forbidden subject: %q", got)
	}
	if !strings.HasPrefix(got, "chore: ") {
		t.Fatalf("fallback should stay a valid Conventional Commits subject: %q", got)
	}
}

func TestSanitizeCommitMessageFallsBackToTheSummary(t *testing.T) {
	got := sanitizeCommitMessage("", "fix(demo): correct the greeting")
	if got != "fix(demo): correct the greeting" {
		t.Fatalf("summary fallback not used: %q", got)
	}
}
