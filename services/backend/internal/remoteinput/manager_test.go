package remoteinput

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"kernl.local/harness/backend/internal/app"
)

type fakeProvider struct {
	put     []string
	deleted []string
	putErr  error
}

func (f *fakeProvider) Name() string { return "fake" }
func (f *fakeProvider) Put(_ context.Context, name, _ string) (Publication, error) {
	f.put = append(f.put, name)
	if f.putErr != nil {
		return Publication{}, f.putErr
	}
	return Publication{Provider: "fake", URL: "https://files.example/" + name}, nil
}

func TestPoolFailsOverWhenPreferredAccountPublicationFails(t *testing.T) {
	root := t.TempDir()
	input := filepath.Join(root, "input.zip")
	if err := os.WriteFile(input, []byte("zip"), 0o600); err != nil {
		t.Fatal(err)
	}
	primary := &fakeProvider{putErr: errors.New("unavailable")}
	secondary := &fakeProvider{}
	manager := NewPool([]Instance{{ID: "primary", Priority: 1, Provider: primary}, {ID: "secondary", Priority: 2, Provider: secondary}}, filepath.Join(root, "state.json"))
	publication, err := manager.Publish(context.Background(), app.RemoteInputObject{ObjectName: "input.zip", FilePath: input, Bytes: 3, FileCount: 1, MaxFileSize: 3})
	if err != nil {
		t.Fatal(err)
	}
	if publication.InstanceID != "secondary" || len(primary.put) != 1 || len(secondary.put) != 1 {
		t.Fatalf("unexpected failover: publication=%#v primary=%#v secondary=%#v", publication, primary.put, secondary.put)
	}
}
func (f *fakeProvider) Delete(_ context.Context, name string) error {
	f.deleted = append(f.deleted, name)
	return nil
}

func TestManagerDeletesPublicationsOlderThanSevenDays(t *testing.T) {
	root := t.TempDir()
	input := filepath.Join(root, "input.zip")
	if err := os.WriteFile(input, []byte("zip"), 0o600); err != nil {
		t.Fatal(err)
	}
	provider := &fakeProvider{}
	manager := NewManager(provider, filepath.Join(root, "index.json"))
	current := time.Date(2026, 9, 4, 12, 0, 0, 0, time.UTC)
	manager.now = func() time.Time { return current.Add(-app.RemoteInputRetention - time.Minute) }
	if _, err := manager.Publish(context.Background(), app.RemoteInputObject{ObjectName: "old.zip", FilePath: input, Bytes: 3, FileCount: 1, MaxFileSize: 3}); err != nil {
		t.Fatal(err)
	}
	manager.now = func() time.Time { return current }
	if _, err := manager.Publish(context.Background(), app.RemoteInputObject{ObjectName: "current.zip", FilePath: input, Bytes: 3, FileCount: 1, MaxFileSize: 3}); err != nil {
		t.Fatal(err)
	}
	if len(provider.deleted) != 1 || provider.deleted[0] != "old.zip" {
		t.Fatalf("unexpected deletions: %#v", provider.deleted)
	}
}

func TestPoolUsesPriorityThenFallsBackPerInstanceQuota(t *testing.T) {
	root := t.TempDir()
	input := filepath.Join(root, "input.zip")
	if err := os.WriteFile(input, []byte("zip"), 0o600); err != nil {
		t.Fatal(err)
	}
	primary := &fakeProvider{}
	secondary := &fakeProvider{}
	limits := app.RemoteInputLimits{MaxRequests: 1, WindowSeconds: 3600, MaxFiles: 4, MaxFileBytes: 10, MaxInputBytes: 20, MaxStoredObjects: 2, MaxStorageBytes: 30}
	instances := []Instance{
		{ID: "secondary-account", Priority: 20, Limits: limits, Provider: secondary},
		{ID: "primary-account", Priority: 10, Limits: limits, Provider: primary},
	}
	statePath := filepath.Join(root, "state.json")
	manager := NewPool(instances, statePath)
	now := time.Date(2026, 9, 4, 12, 0, 0, 0, time.UTC)
	manager.now = func() time.Time { return now }
	object := app.RemoteInputObject{ObjectName: "first.zip", FilePath: input, Bytes: 3, FileCount: 1, MaxFileSize: 3}
	first, err := manager.Publish(context.Background(), object)
	if err != nil {
		t.Fatal(err)
	}
	manager = NewPool(instances, statePath) // request/storage usage survives restart
	manager.now = func() time.Time { return now }
	object.ObjectName = "second.zip"
	second, err := manager.Publish(context.Background(), object)
	if err != nil {
		t.Fatal(err)
	}
	if first.InstanceID != "primary-account" || second.InstanceID != "secondary-account" {
		t.Fatalf("priority/quota selection failed: first=%#v second=%#v", first, second)
	}
	if len(primary.put) != 1 || len(secondary.put) != 1 {
		t.Fatalf("unexpected calls primary=%#v secondary=%#v", primary.put, secondary.put)
	}
	now = now.Add(2 * time.Hour)
	object.ObjectName = "third.zip"
	third, err := manager.Publish(context.Background(), object)
	if err != nil {
		t.Fatal(err)
	}
	if third.InstanceID != "primary-account" {
		t.Fatalf("expected primary after request window reset, got %#v", third)
	}
	status := manager.Status()
	if len(status.Instances) != 2 || status.Instances[0].ID != "primary-account" || status.Instances[0].Usage.RequestsInWindow != 1 || status.Instances[0].Usage.StoredObjects != 2 {
		t.Fatalf("unexpected per-instance status: %#v", status)
	}
}

func TestPoolRejectsObjectAgainstEveryInstanceLimit(t *testing.T) {
	provider := &fakeProvider{}
	manager := NewPool([]Instance{{ID: "small", Priority: 1, Limits: app.RemoteInputLimits{MaxFiles: 2}, Provider: provider}}, filepath.Join(t.TempDir(), "state.json"))
	_, err := manager.Publish(context.Background(), app.RemoteInputObject{ObjectName: "large.zip", FilePath: "unused", Bytes: 10, FileCount: 3, MaxFileSize: 5})
	if err == nil || len(provider.put) != 0 {
		t.Fatalf("expected file-count quota rejection, err=%v calls=%#v", err, provider.put)
	}
}

func TestInstanceLimitsCoverFileInputAndStoredCapacity(t *testing.T) {
	now := time.Date(2026, 9, 4, 12, 0, 0, 0, time.UTC)
	state := managerState{
		Version:  1,
		Records:  []record{{InstanceID: "account", ObjectName: "existing.zip", CreatedAt: now, Bytes: 8}},
		Requests: map[string][]time.Time{"account": {now.Add(-time.Minute)}},
	}
	object := app.RemoteInputObject{ObjectName: "new.zip", Bytes: 5, FileCount: 3, MaxFileSize: 4}
	cases := []struct {
		name   string
		limits app.RemoteInputLimits
		reason string
	}{
		{"requests", app.RemoteInputLimits{MaxRequests: 1, WindowSeconds: 3600}, "request window limit reached"},
		{"files", app.RemoteInputLimits{MaxFiles: 2}, "file count limit exceeded"},
		{"file bytes", app.RemoteInputLimits{MaxFileBytes: 3}, "per-file size limit exceeded"},
		{"input bytes", app.RemoteInputLimits{MaxInputBytes: 4}, "input size limit exceeded"},
		{"objects", app.RemoteInputLimits{MaxStoredObjects: 1}, "stored object limit reached"},
		{"storage", app.RemoteInputLimits{MaxStorageBytes: 12}, "storage capacity limit exceeded"},
	}
	manager := NewPool(nil, filepath.Join(t.TempDir(), "state.json"))
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			instance := Instance{ID: "account", Limits: tc.limits, Provider: &fakeProvider{}}
			if got := manager.ineligible(instance, state, object, now); got != tc.reason {
				t.Fatalf("got %q, want %q", got, tc.reason)
			}
		})
	}
}
