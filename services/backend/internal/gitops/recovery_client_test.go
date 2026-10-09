package gitops

import (
	"context"
	"encoding/json"
	"net"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"kernl.local/harness/backend/internal/oplog"
)

type records struct {
	sync.Mutex
	items []oplog.Record
}

func (s *records) AppendOperationalLog(_ context.Context, batch []oplog.Record) error {
	s.Lock()
	defer s.Unlock()
	s.items = append(s.items, batch...)
	return nil
}

func TestRecoveryUsesHostDecisionAndRecordsCorrelation(t *testing.T) {
	for _, kind := range []string{"success", "refused", "legacy", "missing", "invalid"} {
		t.Run(kind, func(t *testing.T) {
			dir, err := os.MkdirTemp("/tmp", "whx-bridge-")
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = os.RemoveAll(dir) })
			socket := filepath.Join(dir, "git.sock")
			t.Setenv("HARNESS_HOST_GIT_SOCKET", socket)
			if kind != "missing" {
				listener, err := net.Listen("unix", socket)
				if err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() { _ = listener.Close() })
				go func() {
					conn, err := listener.Accept()
					if err != nil {
						return
					}
					defer conn.Close()
					var request HostRequest
					if err := json.NewDecoder(conn).Decode(&request); err != nil {
						t.Error(err)
						return
					}
					if request.Operation != "recover_index_lock" || request.Root != "/project" {
						t.Errorf("%+v", request)
						return
					}
					var response string
					switch kind {
					case "success":
						response = `{"exit_code":0,"recovery":{"recovered":true,"reason":"abandoned","path":"/project/.git/index.lock","age_seconds":86400}}`
					case "refused":
						response = `{"exit_code":0,"recovery":{"recovered":false,"reason":"git_process_active"}}`
					case "legacy":
						response = `{"exit_code":-1,"error":"unsupported host Git operation"}`
					case "invalid":
						response = `{"exit_code":0,"recovery":{"recovered":true,"reason":"abandoned","delete_anything":true}}`
					}
					_, _ = conn.Write([]byte(response))
				}()
			}
			store := &records{}
			writer := oplog.NewWriter(store, 200)
			oplog.SetDefault(writer)
			ctx := WithCorrelation(context.Background(), Correlation{SessionID: "session", RequestID: "request", ChatID: "chat"})
			got := recoverLock(ctx, "/project")
			oplog.SetDefault(nil)
			writer.Close()
			if got != (kind == "success") {
				t.Fatalf("unsafe recovery result: %v", got)
			}
			if len(store.items) != 1 {
				t.Fatalf("records: %d", len(store.items))
			}
			record := store.items[0]
			if record.SessionID != "session" || record.RequestID != "request" || record.ChatID != "chat" || record.ProjectID != "/project" {
				t.Fatalf("uncorrelated: %+v", record)
			}
			if record.Category != "integration" {
				t.Fatalf("unclassified: %+v", record)
			}
		})
	}
}
