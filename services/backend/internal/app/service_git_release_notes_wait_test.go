package app

import (
	"testing"
	"time"
)

func TestGitReleaseNotesWaitCoversPacedWorkerRetries(t *testing.T) {
	// The Desktop permits three attempts. Each can spend four minutes after
	// submission, while the Worker claim, navigation and global pacer run first.
	minimum := 3 * (4*time.Minute + time.Minute)
	if gitReleaseNotesAwaitTimeout < minimum {
		t.Fatalf("release-notes caller expires before the three Worker attempts: %s < %s", gitReleaseNotesAwaitTimeout, minimum)
	}
	if gitReleaseNotesAwaitTimeout > 20*time.Minute {
		t.Fatalf("release-notes caller has no useful upper bound: %s", gitReleaseNotesAwaitTimeout)
	}
}
