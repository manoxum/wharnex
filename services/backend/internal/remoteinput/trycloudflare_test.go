package remoteinput

import (
	"archive/zip"
	"bufio"
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"kernl.local/harness/backend/internal/app"
)

func TestCloudflaredStarterProcessOutlivesStartupContext(t *testing.T) {
	var command *exec.Cmd
	var commandArgs []string
	starter := cloudflaredStarter{command: func(_ string, args ...string) *exec.Cmd {
		commandArgs = append([]string(nil), args...)
		command = exec.Command(os.Args[0], "-test.run=TestCloudflaredHelperProcess")
		command.Env = append(os.Environ(), "WHARNESS_CLOUDFLARED_HELPER=1")
		return command
	}}
	ctx, cancel := context.WithCancel(context.Background())
	public, stop, err := starter.Start(ctx, "http://127.0.0.1:1")
	if err != nil {
		t.Fatalf("start fake cloudflared: %v", err)
	}
	if public.Hostname() != "starter-lifetime.trycloudflare.com" {
		t.Fatalf("unexpected public URL: %s", public)
	}
	if !strings.Contains(strings.Join(commandArgs, " "), "--protocol http2") {
		t.Fatalf("cloudflared did not use stable HTTP/2 transport: %#v", commandArgs)
	}
	cancel()
	time.Sleep(50 * time.Millisecond)
	if command.ProcessState != nil {
		t.Fatal("cloudflared process stopped with the startup context")
	}
	stop()
	if command.ProcessState == nil {
		t.Fatal("cloudflared stop did not reap the process")
	}
}

func TestCloudflaredHelperProcess(t *testing.T) {
	if os.Getenv("WHARNESS_CLOUDFLARED_HELPER") != "1" {
		return
	}
	_, _ = os.Stderr.WriteString("https://starter-lifetime.trycloudflare.com\n")
	for {
		time.Sleep(time.Hour)
	}
}

type fakeQuickTunnelStarter struct {
	origin string
	stops  int
}

func TestQuickTunnelReadinessRequiresWharnessSignature(t *testing.T) {
	var attempts atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if attempts.Add(1) < 2 {
			http.Error(w, "not ready", http.StatusBadGateway)
			return
		}
		w.Header().Set("X-Wharness-Tunnel", "ready")
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()
	public, err := url.Parse(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := waitQuickTunnelReachable(ctx, public); err != nil {
		t.Fatal(err)
	}
	if attempts.Load() < 4 {
		t.Fatal("readiness returned before three stable public round trips")
	}
}

func TestQuickTunnelReadinessRouteDoesNotWaitForProviderLock(t *testing.T) {
	provider, err := newTryCloudflareProvider(TryCloudflareConfig{StorageDir: t.TempDir()}, &fakeQuickTunnelStarter{})
	if err != nil {
		t.Fatal(err)
	}
	provider.mu.Lock()
	done := make(chan int, 1)
	go func() {
		recorder := httptest.NewRecorder()
		provider.serveHTTP(recorder, httptest.NewRequest(http.MethodGet, "http://local/"+tryCloudflareReadinessPath, nil))
		done <- recorder.Code
	}()
	select {
	case status := <-done:
		provider.mu.Unlock()
		if status != http.StatusNoContent {
			t.Fatalf("readiness status = %d", status)
		}
	case <-time.After(200 * time.Millisecond):
		provider.mu.Unlock()
		t.Fatal("readiness route blocked on provider state")
	}
}

func TestTunnelRootReturnsLandingAndStatusReturnsSafeOperationalFeedback(t *testing.T) {
	provider, err := newTryCloudflareProvider(TryCloudflareConfig{StorageDir: t.TempDir(), Landing: TunnelLanding{InstanceName: "Oficina da Ana", Origins: []string{"https://secondary.example.com", "https://primary.example.com", "https://primary.example.com"}}}, &fakeQuickTunnelStarter{})
	if err != nil {
		t.Fatal(err)
	}
	recorder := httptest.NewRecorder()
	provider.serveHTTP(recorder, httptest.NewRequest(http.MethodGet, "http://local/", nil))
	if recorder.Code != http.StatusOK || recorder.Header().Get("Content-Type") != "text/html; charset=utf-8" {
		t.Fatalf("root landing response: %d %#v", recorder.Code, recorder.Header())
	}
	if !strings.Contains(recorder.Body.String(), "Oficina da Ana") || !strings.Contains(recorder.Body.String(), "https://primary.example.com") || !strings.Contains(recorder.Body.String(), "https://secondary.example.com") || !strings.Contains(recorder.Body.String(), "data:image/png;base64,") || !strings.Contains(recorder.Body.String(), "href=\"/status\"") {
		t.Fatalf("root landing is missing its public status link: %q", recorder.Body.String())
	}
	recorder = httptest.NewRecorder()
	provider.serveHTTP(recorder, httptest.NewRequest(http.MethodGet, "http://local/status", nil))
	if recorder.Code != http.StatusOK || recorder.Header().Get("Content-Type") != "application/json" || recorder.Body.String() != "{\"protocol\":\"wharness.tunnel-status/v1\",\"status\":\"ok\"}\n" {
		t.Fatalf("status response leaked or changed data: %d %#v %q", recorder.Code, recorder.Header(), recorder.Body.String())
	}
}

func TestTryCloudflareRequestChannelServesTypedSecretResourcesAndEvents(t *testing.T) {
	root := t.TempDir()
	resource := filepath.Join(root, "manifest.json")
	if err := os.WriteFile(resource, []byte(`{"protocol":"wharness.remote-channel/v1"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	starter := &fakeQuickTunnelStarter{}
	provider, err := newTryCloudflareProvider(TryCloudflareConfig{StorageDir: filepath.Join(root, "objects")}, starter)
	if err != nil {
		t.Fatal(err)
	}
	provider.ready = func(context.Context, *url.URL) error { return nil }
	channelID := "0123456789abcdef0123456789abcdef"
	publication, err := provider.PublishChannel(context.Background(), app.RemoteInputChannel{ChannelID: channelID, RootRequest: "req_1", Resources: []app.RemoteInputChannelResource{{Path: "manifest.json", FilePath: resource, ContentType: "application/json"}}})
	if err != nil {
		t.Fatal(err)
	}
	if publication.URL != "https://unit-test.trycloudflare.com/"+channelID+"/manifest.json" {
		t.Fatalf("unexpected channel URL: %q", publication.URL)
	}
	recorder := httptest.NewRecorder()
	provider.serveHTTP(recorder, httptest.NewRequest(http.MethodGet, "http://local/"+channelID+"/manifest.json", nil))
	if recorder.Code != http.StatusOK || recorder.Header().Get("Content-Type") != "application/json" || recorder.Body.String() != `{"protocol":"wharness.remote-channel/v1"}` {
		t.Fatalf("manifest response: status=%d headers=%#v body=%q", recorder.Code, recorder.Header(), recorder.Body.String())
	}
	archive := filepath.Join(root, "context-file")
	if err := os.WriteFile(archive, []byte("context"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := provider.UpdateChannel(context.Background(), app.RemoteInputChannelUpdate{ChannelID: channelID, Resources: []app.RemoteInputChannelResource{{Path: "files/context/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", FilePath: archive, ContentType: "text/plain; charset=utf-8"}}, Event: "context.changed"}); err != nil {
		t.Fatal(err)
	}
	recorder = httptest.NewRecorder()
	provider.serveHTTP(recorder, httptest.NewRequest(http.MethodGet, "http://local/"+channelID+"/files/context/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", nil))
	if recorder.Code != http.StatusOK || recorder.Body.String() != "context" {
		t.Fatalf("individual file response is invalid: %d %q", recorder.Code, recorder.Body.String())
	}
	recorder = httptest.NewRecorder()
	provider.serveHTTP(recorder, httptest.NewRequest(http.MethodGet, "http://local/ffffffffffffffffffffffffffffffff/manifest.json", nil))
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("wrong secret exposed channel: %d", recorder.Code)
	}

	server := httptest.NewServer(http.HandlerFunc(provider.serveHTTP))
	defer server.Close()
	response, err := server.Client().Get(server.URL + "/" + channelID + "/events")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	scanner := bufio.NewScanner(response.Body)
	for scanner.Scan() && scanner.Text() != "" {
	}
	updatedState := filepath.Join(root, "state.json")
	if err := os.WriteFile(updatedState, []byte(`{"generation":2}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := provider.UpdateChannel(context.Background(), app.RemoteInputChannelUpdate{ChannelID: channelID, Resources: []app.RemoteInputChannelResource{{Path: "state.json", FilePath: updatedState, ContentType: "application/json"}}, Event: "context.changed", Data: map[string]string{"generation": "2"}}); err != nil {
		t.Fatal(err)
	}
	event := make(chan string, 1)
	go func() {
		for scanner.Scan() {
			if scanner.Text() == "event: context.changed" {
				event <- scanner.Text()
				return
			}
		}
	}()
	select {
	case <-event:
	case <-time.After(time.Second):
		t.Fatal("SSE subscriber did not receive context.changed")
	}
	if err := provider.CloseChannel(context.Background(), channelID); err != nil {
		t.Fatal(err)
	}
	if starter.stops != 0 {
		t.Fatalf("closing a request channel stopped the session tunnel: %d", starter.stops)
	}
	if err := provider.StopSession(context.Background()); err != nil {
		t.Fatal(err)
	}
	if starter.stops != 1 {
		t.Fatalf("closing the Wharness session must stop the tunnel: %d", starter.stops)
	}
}

func (s *fakeQuickTunnelStarter) Start(_ context.Context, origin string) (*url.URL, func(), error) {
	s.origin = origin
	public, _ := url.Parse("https://unit-test.trycloudflare.com")
	return public, func() { s.stops++ }, nil
}

func TestTryCloudflareArchiveBackedContextIsLazyAndRehydrates(t *testing.T) {
	root := t.TempDir()
	manifest := filepath.Join(root, "manifest.json")
	if err := os.WriteFile(manifest, []byte(`{"protocol":"wharness.remote-channel/v2"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	contextArchive := filepath.Join(root, "context.zip")
	archiveFile, err := os.Create(contextArchive)
	if err != nil {
		t.Fatal(err)
	}
	writer := zip.NewWriter(archiveFile)
	entry, err := writer.Create("src/main.txt")
	if err == nil {
		_, err = entry.Write([]byte("hello from snapshot"))
	}
	if closeErr := writer.Close(); err == nil {
		err = closeErr
	}
	if closeErr := archiveFile.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		t.Fatal(err)
	}
	storage := filepath.Join(root, "objects")
	provider, err := newTryCloudflareProvider(TryCloudflareConfig{StorageDir: storage}, &fakeQuickTunnelStarter{})
	if err != nil {
		t.Fatal(err)
	}
	provider.ready = func(context.Context, *url.URL) error { return nil }
	if err := provider.StartSession(context.Background()); err != nil {
		t.Fatal(err)
	}
	channelID := "abcdef0123456789abcdef0123456789"
	archiveID := strings.Repeat("a", 64)
	resourcePath := "files/context/" + strings.Repeat("b", 64)
	publication, err := provider.PublishChannel(context.Background(), app.RemoteInputChannel{ChannelID: channelID, RootRequest: "req_1", Resources: []app.RemoteInputChannelResource{
		{Path: "manifest.json", FilePath: manifest, ContentType: "application/json", Bytes: 41},
		{Path: resourcePath, ContentType: "text/plain; charset=utf-8", Bytes: int64(len("hello from snapshot")), ArchivePath: contextArchive, ArchiveEntry: "src/main.txt", ArchiveID: archiveID},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(storage, "channels", channelID, filepath.FromSlash(resourcePath))); !os.IsNotExist(err) {
		t.Fatalf("context route was eagerly materialized instead of remaining snapshot-backed: %v", err)
	}
	if _, err := os.Stat(filepath.Join(storage, "channels", channelID, ".snapshots", archiveID+".zip")); err != nil {
		t.Fatalf("private context snapshot was not persisted once: %v", err)
	}
	requestURL := strings.TrimSuffix(publication.URL, "/manifest.json") + "/" + resourcePath
	recorder := httptest.NewRecorder()
	provider.serveHTTP(recorder, httptest.NewRequest(http.MethodGet, requestURL, nil))
	if recorder.Code != http.StatusOK || recorder.Body.String() != "hello from snapshot" {
		t.Fatalf("lazy snapshot route response: %d %q", recorder.Code, recorder.Body.String())
	}
	if err := provider.StopSession(context.Background()); err != nil {
		t.Fatal(err)
	}
	second, err := newTryCloudflareProvider(TryCloudflareConfig{StorageDir: storage}, &fakeQuickTunnelStarter{})
	if err != nil {
		t.Fatal(err)
	}
	second.ready = func(context.Context, *url.URL) error { return nil }
	if err := second.StartSession(context.Background()); err != nil {
		t.Fatal(err)
	}
	recorder = httptest.NewRecorder()
	second.serveHTTP(recorder, httptest.NewRequest(http.MethodGet, requestURL, nil))
	if recorder.Code != http.StatusOK || recorder.Body.String() != "hello from snapshot" {
		t.Fatalf("rehydrated lazy snapshot route response: %d %q", recorder.Code, recorder.Body.String())
	}
}

func TestQuickTunnelStartsAtBackendSessionStartup(t *testing.T) {
	starter := &fakeQuickTunnelStarter{}
	provider, err := newTryCloudflareProvider(TryCloudflareConfig{StorageDir: t.TempDir()}, starter)
	if err != nil {
		t.Fatal(err)
	}
	provider.ready = func(context.Context, *url.URL) error { return nil }
	if err := provider.StartSession(context.Background()); err != nil {
		t.Fatal(err)
	}
	if starter.origin == "" || provider.public == nil {
		t.Fatal("Quick Tunnel was not warmed before the first request publication")
	}
	if err := provider.StopSession(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestTunnelChannelRehydratesFromDiskAfterProviderRestart(t *testing.T) {
	root := t.TempDir()
	manifest := filepath.Join(root, "manifest.json")
	if err := os.WriteFile(manifest, []byte(`{"protocol":"wharness.remote-channel/v1"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	storage := filepath.Join(root, "objects")
	first, err := newTryCloudflareProvider(TryCloudflareConfig{StorageDir: storage}, &fakeQuickTunnelStarter{})
	if err != nil {
		t.Fatal(err)
	}
	first.ready = func(context.Context, *url.URL) error { return nil }
	channelID := "abcdef0123456789abcdef0123456789"
	publication, err := first.PublishChannel(context.Background(), app.RemoteInputChannel{ChannelID: channelID, RootRequest: "req_1", Resources: []app.RemoteInputChannelResource{{Path: "manifest.json", FilePath: manifest, ContentType: "application/json"}}})
	if err != nil {
		t.Fatal(err)
	}
	if err := first.StopSession(context.Background()); err != nil {
		t.Fatal(err)
	}
	second, err := newTryCloudflareProvider(TryCloudflareConfig{StorageDir: storage}, &fakeQuickTunnelStarter{})
	if err != nil {
		t.Fatal(err)
	}
	second.ready = func(context.Context, *url.URL) error { return nil }
	if err := second.StartSession(context.Background()); err != nil {
		t.Fatal(err)
	}
	recorder := httptest.NewRecorder()
	second.serveHTTP(recorder, httptest.NewRequest(http.MethodGet, publication.URL, nil))
	if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), "wharness.remote-channel/v1") {
		t.Fatalf("rehydrated channel response: %d %q", recorder.Code, recorder.Body.String())
	}
}

func TestTryCloudflareProviderKeepsTunnelUntilLastRequestLeaseReleases(t *testing.T) {
	root := t.TempDir()
	source := filepath.Join(root, "input.zip")
	if err := os.WriteFile(source, []byte("PK\x03\x04test"), 0o600); err != nil {
		t.Fatal(err)
	}
	starter := &fakeQuickTunnelStarter{}
	provider, err := newTryCloudflareProvider(TryCloudflareConfig{StorageDir: filepath.Join(root, "objects")}, starter)
	if err != nil {
		t.Fatal(err)
	}
	provider.ready = func(context.Context, *url.URL) error { return nil }
	if _, err := provider.Put(context.Background(), "first.zip", source); err != nil {
		t.Fatal(err)
	}
	if _, err := provider.Put(context.Background(), "second.zip", source); err != nil {
		t.Fatal(err)
	}
	if err := provider.Retain("first.zip"); err != nil {
		t.Fatal(err)
	}
	if err := provider.Retain("second.zip"); err != nil {
		t.Fatal(err)
	}
	if err := provider.Release("first.zip"); err != nil {
		t.Fatal(err)
	}
	if starter.stops != 0 {
		t.Fatalf("tunnel stopped while another request remains active: %d", starter.stops)
	}
	if err := provider.Release("second.zip"); err != nil {
		t.Fatal(err)
	}
	if starter.stops != 0 {
		t.Fatalf("final request release stopped the session tunnel: %d", starter.stops)
	}
	if err := provider.StopSession(context.Background()); err != nil {
		t.Fatal(err)
	}
	if starter.stops != 1 {
		t.Fatalf("session close should stop the tunnel: %d", starter.stops)
	}
}

func TestTryCloudflareProviderServesOnlyManagedZIPObjects(t *testing.T) {
	root := t.TempDir()
	source := filepath.Join(root, "input.zip")
	contents := []byte("PK\x03\x04test")
	if err := os.WriteFile(source, contents, 0o600); err != nil {
		t.Fatal(err)
	}
	starter := &fakeQuickTunnelStarter{}
	provider, err := newTryCloudflareProvider(TryCloudflareConfig{StorageDir: filepath.Join(root, "objects")}, starter)
	if err != nil {
		t.Fatal(err)
	}
	provider.ready = func(context.Context, *url.URL) error { return nil }
	publication, err := provider.Put(context.Background(), "context.zip", source)
	if err != nil {
		t.Fatal(err)
	}
	if publication.URL != "https://unit-test.trycloudflare.com/context.zip" {
		t.Fatalf("unexpected publication: %#v", publication)
	}
	origin, err := url.Parse(starter.origin)
	if err != nil || origin.Scheme != "http" || origin.Hostname() != "127.0.0.1" || origin.Port() == "" || origin.Port() == "0" {
		t.Fatalf("quick tunnel must receive a dynamically allocated loopback origin, got %q", starter.origin)
	}
	recorder := httptest.NewRecorder()
	provider.serveHTTP(recorder, httptest.NewRequest(http.MethodGet, "http://local/context.zip", nil))
	if recorder.Code != http.StatusOK || recorder.Header().Get("Content-Type") != "application/zip" || string(recorder.Body.Bytes()) != string(contents) {
		t.Fatalf("managed object response: status=%d headers=%#v body=%q", recorder.Code, recorder.Header(), recorder.Body.Bytes())
	}
	for _, path := range []string{"/../context.zip", "/not-managed.zip"} {
		recorder = httptest.NewRecorder()
		provider.serveHTTP(recorder, httptest.NewRequest(http.MethodGet, "http://local"+path, nil))
		if recorder.Code != http.StatusNotFound {
			t.Fatalf("unexpected public path %q returned %d", path, recorder.Code)
		}
	}
	if err := provider.Delete(context.Background(), "context.zip"); err != nil {
		t.Fatal(err)
	}
	recorder = httptest.NewRecorder()
	provider.serveHTTP(recorder, httptest.NewRequest(http.MethodGet, "http://local/context.zip", nil))
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("deleted object still accessible: %d", recorder.Code)
	}
}
