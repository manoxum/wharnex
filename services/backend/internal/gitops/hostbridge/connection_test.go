package hostbridge

import (
	"context"
	"encoding/json"
	"net"
	"testing"

	"kernl.local/harness/backend/internal/gitops"
)

func TestRecoveryCannotBecomeGenericHostExecution(t *testing.T) {
	for _, payload := range []string{
		`{"operation":"recover_index_lock","root":"/project","remote":"origin"}`,
		`{"operation":"recover_index_lock","root":"/project","body":"rm anything"}`,
		`{"operation":"recover_index_lock","root":"/project","argv":["sh","-c","anything"]}`,
		`{"operation":"recover_index_lock","root":"/project","path":"/etc/passwd"}`,
	} {
		t.Run(payload, func(t *testing.T) {
			server, client := net.Pipe()
			defer client.Close()
			called := false
			done := make(chan struct{})
			go func() {
				defer close(done)
				ServeConnection(context.Background(), server,
					func(context.Context, gitops.HostRequest) (string, error) { called = true; return "", nil },
					func(gitops.HostRequest) ([]string, error) { called = true; return nil, nil },
				)
			}()
			if _, err := client.Write([]byte(payload + "\n")); err != nil {
				t.Fatal(err)
			}
			var result gitops.HostResult
			if err := json.NewDecoder(client).Decode(&result); err != nil {
				t.Fatal(err)
			}
			<-done
			if called || result.ExitCode != -1 || result.Error == "" {
				t.Fatalf("unexpected dispatch: %+v", result)
			}
		})
	}
}

func TestValidRecoveryUsesOnlyTheHostProof(t *testing.T) {
	server, client := net.Pipe()
	defer client.Close()
	done := make(chan struct{})
	go func() {
		defer close(done)
		ServeConnection(context.Background(), server,
			func(context.Context, gitops.HostRequest) (string, error) { t.Error("release invoked"); return "", nil },
			func(gitops.HostRequest) ([]string, error) { t.Error("argv invoked"); return nil, nil },
		)
	}()
	// An absent root must yield a structured refusal without invoking any
	// remote-operation adapter, on hosts as well as inside containers.
	root := t.TempDir() + "/missing"
	if err := json.NewEncoder(client).Encode(gitops.HostRequest{Operation: "recover_index_lock", Root: root}); err != nil {
		t.Fatal(err)
	}
	var result gitops.HostResult
	if err := json.NewDecoder(client).Decode(&result); err != nil {
		t.Fatal(err)
	}
	<-done
	if result.Recovery == nil || result.Recovery.Recovered || result.Recovery.Reason == "" {
		t.Fatalf("%+v", result)
	}
}
