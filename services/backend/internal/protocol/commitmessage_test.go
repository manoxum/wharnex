package protocol

import (
	"strings"
	"testing"
)

func TestValidateCommitMessageAcceptsSubjectWithReasoningBody(t *testing.T) {
	message := "fix(auth): keep the session valid during concurrent token refresh\n" +
		"\n" +
		"Two refreshes racing on the same session invalidated the older token\n" +
		"after the newer one had already been issued, logging the user out.\n" +
		"\n" +
		"The refresh now swaps atomically, so the loser observes the winner's\n" +
		"token instead of revoking it.\n"
	if err := ValidateCommitMessage(message); err != nil {
		t.Fatalf("a subject plus explanatory body is the target shape: %v", err)
	}
}

func TestValidateCommitMessageAcceptsBareSubject(t *testing.T) {
	if err := ValidateCommitMessage("feat(chat): preserve project affinity across restores"); err != nil {
		t.Fatalf("a well-formed subject alone must remain valid: %v", err)
	}
}

func TestValidateCommitMessageRejectsBookkeepingSubjects(t *testing.T) {
	// Exactly the subjects the published protocol tells the planner never to
	// emit. Prose rules that nothing enforces are how they kept appearing.
	for _, subject := range []string{
		"chore: update files", "chore: apply patch", "fix: requested changes",
		"feat: implement task", "fix: miscellaneous fixes", "chore: Wharness-verified change",
		"chore: updates", "fix: various fixes", "chore: cleanup",
	} {
		if err := ValidateCommitMessage(subject); err == nil {
			t.Fatalf("expected %q to be rejected as bookkeeping", subject)
		}
	}
}

func TestValidateCommitMessageRequiresConventionalCommitsShape(t *testing.T) {
	for _, subject := range []string{
		"replace the hello greeting text",           // no type
		"improve(auth): rotate tokens concurrently", // type outside the closed set
		"fix:",                        // no description
		"fix(): rotate tokens safely", // empty scope
	} {
		if err := ValidateCommitMessage(subject); err == nil {
			t.Fatalf("expected %q to be rejected", subject)
		}
	}
}

func TestValidateCommitMessageRejectsIdentifierDescriptions(t *testing.T) {
	if err := ValidateCommitMessage("chore: req_20260909T191941_cd0aa0a7"); err == nil {
		t.Fatal("a bare request id is not a described outcome")
	}
}

func TestValidateCommitMessageRequiresBlankLineBeforeBody(t *testing.T) {
	message := "fix(auth): rotate the refresh token atomically\nThis line should have been separated."
	if err := ValidateCommitMessage(message); err == nil {
		t.Fatal("Git treats only the first line as the subject; a body needs its blank separator")
	}
}

func TestValidateCommitMessageBoundsSubjectLength(t *testing.T) {
	long := "fix(auth): " + strings.Repeat("a", MaxCommitSubjectLength)
	err := ValidateCommitMessage(long)
	if err == nil {
		t.Fatal("an overlong subject must be rejected")
	}
	if !strings.Contains(err.Error(), "body") {
		t.Fatalf("the error should tell the planner where the detail belongs: %v", err)
	}
}

func TestValidateCommitMessageRequiresAMessageAtAll(t *testing.T) {
	if err := ValidateCommitMessage("   "); err == nil {
		t.Fatal("a change plan without a commit message must be rejected")
	}
}

func TestValidateCommitMessageAcceptsBreakingChangeMarker(t *testing.T) {
	if err := ValidateCommitMessage("feat(api)!: require an explicit tenant on every request"); err != nil {
		t.Fatalf("the Conventional Commits breaking marker is valid: %v", err)
	}
}
