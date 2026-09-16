package sandbox

import "testing"

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
