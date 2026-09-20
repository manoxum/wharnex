package sandbox

import (
	"strings"
	"testing"
)

func TestHostGitArgsAllowsOnlyBoundedRemoteOperations(t *testing.T) {
	root := t.TempDir()
	cases := []struct {
		name string
		req  HostGitRequest
		want string
	}{
		{name: "fetch", req: HostGitRequest{Operation: "fetch", Root: root, Remote: "origin"}, want: "fetch"},
		{name: "push", req: HostGitRequest{Operation: "push", Root: root, Remote: "origin", Branch: "main", SetUpstream: true}, want: "push"},
		{name: "selected push", req: HostGitRequest{Operation: "push_commit", Root: root, Remote: "origin", Branch: "main", CommitSHA: "0123456789abcdef0123456789abcdef01234567"}, want: "push"},
		{name: "delete branch", req: HostGitRequest{Operation: "delete_branch", Root: root, Remote: "origin", Branch: "feature/old"}, want: "push"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			args, err := hostGitArgs(tc.req)
			if err != nil {
				t.Fatalf("hostGitArgs: %v", err)
			}
			if len(args) == 0 || args[0] != tc.want {
				t.Fatalf("unexpected args: %#v", args)
			}
		})
	}
}

func TestHostGitArgsRejectsGenericExecution(t *testing.T) {
	_, err := hostGitArgs(HostGitRequest{Operation: "exec", Root: t.TempDir(), Remote: "origin", Branch: "main"})
	if err == nil {
		t.Fatal("generic host execution must be rejected")
	}
}

func TestHostGitArgsAllowsTagPush(t *testing.T) {
	root := t.TempDir()
	args, err := hostGitArgs(HostGitRequest{Operation: "push_tag", Root: root, Remote: "origin", Tag: "v1.2.3"})
	if err != nil {
		t.Fatalf("hostGitArgs: %v", err)
	}
	if got := strings.Join(args, " "); !strings.Contains(got, "refs/tags/v1.2.3:refs/tags/v1.2.3") {
		t.Fatalf("unexpected tag push args: %v", args)
	}
}

func TestGitHubRepositoryParsesHTTPSAndSSH(t *testing.T) {
	for _, tc := range []struct {
		raw   string
		owner string
		repo  string
	}{
		{raw: "https://github.com/acme/widget.git", owner: "acme", repo: "widget"},
		{raw: "git@github.com:acme/widget.git", owner: "acme", repo: "widget"},
	} {
		owner, repo, _, err := githubRepository(tc.raw)
		if err != nil {
			t.Fatalf("githubRepository(%q): %v", tc.raw, err)
		}
		if owner != tc.owner || repo != tc.repo {
			t.Fatalf("githubRepository(%q) = %s/%s", tc.raw, owner, repo)
		}
	}
}
