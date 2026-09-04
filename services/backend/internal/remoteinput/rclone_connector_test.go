package remoteinput

import (
	"context"
	"reflect"
	"testing"

	"kernl.local/harness/backend/internal/app"
)

type connectorRunnerCapture struct {
	args []string
	err  error
}

func (r *connectorRunnerCapture) Run(_ context.Context, args ...string) error {
	r.args = append([]string(nil), args...)
	return r.err
}

func TestRcloneConnectorStartsBrowserOAuthForDrive(t *testing.T) {
	runner := &connectorRunnerCapture{}
	connector := &RcloneConnector{runner: runner, available: true}
	connection, err := connector.Connect(context.Background(), app.RemoteStorageConnectionRequest{InstanceID: "drive-main", Provider: "drive"})
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"config", "create", "wharness-drive-main", "drive", "config_is_local", "true", "--non-interactive", "--obscure"}
	if !reflect.DeepEqual(runner.args, want) {
		t.Fatalf("args = %#v, want %#v", runner.args, want)
	}
	if !connection.Connected || connection.Remote != "wharness-drive-main" {
		t.Fatalf("unexpected connection: %#v", connection)
	}
}

func TestRcloneConnectorMapsNextcloudCredentials(t *testing.T) {
	runner := &connectorRunnerCapture{}
	connector := &RcloneConnector{runner: runner, available: true}
	_, err := connector.Connect(context.Background(), app.RemoteStorageConnectionRequest{
		InstanceID: "private-cloud", Provider: "nextcloud",
		Fields: map[string]string{"url": "https://cloud.example/dav", "user": "ana", "pass": "private"},
	})
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"config", "create", "wharness-private-cloud", "webdav", "pass", "private", "url", "https://cloud.example/dav", "user", "ana", "vendor", "nextcloud", "--non-interactive", "--obscure"}
	if !reflect.DeepEqual(runner.args, want) {
		t.Fatalf("args = %#v, want %#v", runner.args, want)
	}
}

func TestRcloneConnectorRejectsDeletingUnmanagedRemote(t *testing.T) {
	runner := &connectorRunnerCapture{}
	connector := &RcloneConnector{runner: runner, available: true}
	if err := connector.Disconnect(context.Background(), "personal-drive"); err == nil {
		t.Fatal("expected unmanaged remote deletion to be rejected")
	}
	if len(runner.args) != 0 {
		t.Fatal("runner must not be called for unmanaged remote")
	}
}
