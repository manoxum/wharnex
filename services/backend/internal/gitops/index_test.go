package gitops

import (
	"context"
	"errors"
	"io"
	"os/exec"
	"strings"
	"testing"
)

func TestSelectGitlinksPreservesStagesAndNULPaths(t *testing.T) {
	want := "160000 abc 0\tmodule with\t tab\nnewline\x00" +
		"160000 def 1\tconflict\x00" + "160000 fed 3\tconflict\x00"
	input := "100644 abc 0\tnormal\x00" + want + "100755 def 0\texecutable\x00"
	got, err := selectGitlinks(strings.NewReader(input))
	if err != nil || got != want {
		t.Fatalf("gitlinks = %q, %v; want %q", got, err, want)
	}
}

func TestSelectGitlinksRejectsTruncatedAndOversizedRecords(t *testing.T) {
	_, err := selectGitlinks(strings.NewReader("160000 abc 0\tunterminated"))
	if !errors.Is(err, io.ErrUnexpectedEOF) {
		t.Fatalf("truncated record = %v", err)
	}
	_, err = selectGitlinks(strings.NewReader(strings.Repeat("x", (1<<20)+1) + "\x00"))
	if err == nil {
		t.Fatal("unbounded record accepted")
	}
}

func TestIndexGitlinksPropagatesProcessFailureAndCancellation(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git unavailable")
	}
	if _, err := IndexGitlinks(context.Background(), t.TempDir()); err == nil {
		t.Fatal("non-repository accepted")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := IndexGitlinks(ctx, t.TempDir()); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancellation = %v", err)
	}
}

func TestIndexDiagnosticRemainsBoundedWhileDraining(t *testing.T) {
	var diagnostic boundedIndexDiagnostic
	input := []byte(strings.Repeat("x", 100_000))
	for range 3 {
		n, err := diagnostic.Write(input)
		if err != nil || n != len(input) {
			t.Fatalf("drain = %d, %v", n, err)
		}
	}
	if diagnostic.Len() != 64<<10 {
		t.Fatalf("diagnostic grew to %d", diagnostic.Len())
	}
}
