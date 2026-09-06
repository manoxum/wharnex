package remoteinput

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

var tryCloudflareURLPattern = regexp.MustCompile(`https://[a-z0-9-]+\.trycloudflare\.com`)

const tryCloudflareReadinessPath = "__wharness_tunnel_ready__"

type TryCloudflareConfig struct {
	StorageDir string
	Landing    TunnelLanding
}

type quickTunnelStarter interface {
	Start(context.Context, string) (*url.URL, func(), error)
}

// TryCloudflareProvider exposes only Wharness-managed ZIP objects through a
// Cloudflare Quick Tunnel. It never forwards the backend's general HTTP API.
type TryCloudflareProvider struct {
	dir            string
	providerName   string
	listenAddr     string
	persistentDNS  bool
	starter        quickTunnelStarter
	ready          func(context.Context, *url.URL) error
	validatePublic func(*url.URL) bool

	mu               sync.Mutex
	listener         net.Listener
	server           *http.Server
	public           *url.URL
	stop             func()
	supervisorCancel context.CancelFunc
	objects          map[string]string
	leases           map[string]struct{}
	channels         map[string]*tryCloudflareChannel
	landingPage      string
}

func NewTryCloudflareProvider(cfg TryCloudflareConfig) (*TryCloudflareProvider, error) {
	if _, err := exec.LookPath("cloudflared"); err != nil {
		return nil, errors.New("cloudflared executable was not found; install cloudflared to use TryCloudflare")
	}
	return newTryCloudflareProvider(cfg, cloudflaredStarter{})
}

func newTryCloudflareProvider(cfg TryCloudflareConfig, starter quickTunnelStarter) (*TryCloudflareProvider, error) {
	return newTunnelProvider(cfg.StorageDir, "trycloudflare", "127.0.0.1:0", false, starter, cfg.Landing, func(public *url.URL) bool {
		return public != nil && public.Scheme == "https" && strings.HasSuffix(strings.ToLower(public.Hostname()), ".trycloudflare.com")
	})
}

func newTunnelProvider(dir, providerName, listenAddr string, persistentDNS bool, starter quickTunnelStarter, landing TunnelLanding, validatePublic func(*url.URL) bool) (*TryCloudflareProvider, error) {
	dir = strings.TrimSpace(dir)
	if dir == "" {
		return nil, errors.New("tunnel storage directory is required")
	}
	if starter == nil {
		return nil, errors.New("tunnel starter is required")
	}
	if strings.TrimSpace(listenAddr) == "" || validatePublic == nil {
		return nil, errors.New("tunnel listener and public URL validator are required")
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, fmt.Errorf("create tunnel storage directory: %w", err)
	}
	provider := &TryCloudflareProvider{dir: dir, providerName: providerName, listenAddr: listenAddr, persistentDNS: persistentDNS, starter: starter, ready: waitQuickTunnelReachable, validatePublic: validatePublic, objects: make(map[string]string), leases: make(map[string]struct{}), channels: make(map[string]*tryCloudflareChannel), landingPage: landing.HTML()}
	if err := provider.loadChannels(); err != nil {
		return nil, err
	}
	return provider, nil
}

func (p *TryCloudflareProvider) Name() string { return p.providerName }

func (p *TryCloudflareProvider) Put(ctx context.Context, objectName, filePath string) (Publication, error) {
	if err := validateObjectName(objectName); err != nil {
		return Publication{}, err
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if err := p.ensureTunnelLocked(ctx); err != nil {
		return Publication{}, err
	}
	target := filepath.Join(p.dir, objectName)
	if err := copyPrivateFile(filePath, target); err != nil {
		return Publication{}, err
	}
	p.objects[objectName] = target
	return Publication{Provider: p.Name(), URL: objectURL(p.public, objectName).String()}, nil
}

func (p *TryCloudflareProvider) Delete(_ context.Context, objectName string) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	path, exists := p.objects[objectName]
	if !exists {
		path = filepath.Join(p.dir, objectName)
	}
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	delete(p.objects, objectName)
	return nil
}

// Retain records that the request owning objectName is still awaiting its
// terminal bundle. A Quick Tunnel must remain available for every such lease.
func (p *TryCloudflareProvider) Retain(objectName string) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if _, exists := p.objects[objectName]; !exists {
		return errors.New("TryCloudflare object is not published")
	}
	p.leases[objectName] = struct{}{}
	return nil
}

// Release ends one request lease. The session-level Quick Tunnel remains ready
// for other chats and future requests until CloseSession is called.
func (p *TryCloudflareProvider) Release(objectName string) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	delete(p.leases, objectName)
	return nil
}

func (p *TryCloudflareProvider) StartSession(ctx context.Context) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if err := p.ensureTunnelLocked(ctx); err != nil {
		return err
	}
	p.startSupervisorLocked()
	return nil
}

func (p *TryCloudflareProvider) StopSession(_ context.Context) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.stopSupervisorLocked()
	p.closeTunnelLocked()
	return nil
}

func (p *TryCloudflareProvider) ClearSession(_ context.Context) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	for channelID, channel := range p.channels {
		p.broadcastChannelEventLocked(channel, "request.terminal", map[string]string{"status": "session_closed"})
		for subscriber := range channel.subscribers {
			close(subscriber)
		}
		delete(p.channels, channelID)
	}
	p.leases = make(map[string]struct{})
	if err := os.RemoveAll(filepath.Join(p.dir, "channels")); err != nil {
		return err
	}
	p.stopSupervisorLocked()
	p.closeTunnelLocked()
	return nil
}

func (p *TryCloudflareProvider) startSupervisorLocked() {
	if !p.persistentDNS || p.supervisorCancel != nil {
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	p.supervisorCancel = cancel
	go p.superviseTunnel(ctx)
}

func (p *TryCloudflareProvider) stopSupervisorLocked() {
	if p.supervisorCancel != nil {
		p.supervisorCancel()
		p.supervisorCancel = nil
	}
}

func (p *TryCloudflareProvider) superviseTunnel(ctx context.Context) {
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	failures := 0
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
		p.mu.Lock()
		public := p.public
		p.mu.Unlock()
		probeCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
		err := probeTunnelReachable(probeCtx, public)
		cancel()
		if err == nil {
			failures = 0
			continue
		}
		failures++
		if failures < 3 {
			continue
		}
		p.mu.Lock()
		p.closeTunnelLocked()
		reconnectCtx, reconnectCancel := context.WithTimeout(ctx, 2*time.Minute)
		_ = p.ensureTunnelLocked(reconnectCtx)
		reconnectCancel()
		p.mu.Unlock()
		failures = 0
	}
}

func (p *TryCloudflareProvider) ensureTunnelLocked(ctx context.Context) error {
	if p.public != nil {
		return nil
	}
	listener, err := net.Listen("tcp", p.listenAddr)
	if err != nil {
		return fmt.Errorf("listen for %s tunnel resources: %w", p.providerName, err)
	}
	p.listener = listener
	p.server = &http.Server{Handler: http.HandlerFunc(p.serveHTTP), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 30 * time.Second, IdleTimeout: time.Minute}
	server := p.server
	go func() { _ = server.Serve(listener) }()
	startCtx, cancel := context.WithTimeout(ctx, 50*time.Second)
	defer cancel()
	public, stop, err := p.starter.Start(startCtx, "http://"+listener.Addr().String())
	if err != nil {
		_ = p.server.Close()
		p.listener = nil
		p.server = nil
		return fmt.Errorf("start %s tunnel: %w", p.providerName, err)
	}
	if !p.validatePublic(public) {
		stop()
		_ = p.server.Close()
		p.listener = nil
		p.server = nil
		return fmt.Errorf("%s returned an invalid public HTTPS URL", p.providerName)
	}
	readyCtx, readyCancel := context.WithTimeout(ctx, 60*time.Second)
	defer readyCancel()
	if err := p.ready(readyCtx, public); err != nil {
		stop()
		_ = p.server.Close()
		p.listener = nil
		p.server = nil
		return fmt.Errorf("wait for %s public readiness: %w", p.providerName, err)
	}
	p.public, p.stop = public, stop
	return nil
}

func (p *TryCloudflareProvider) closeTunnelLocked() {
	if p.stop != nil {
		p.stop()
	}
	server := p.server
	p.listener = nil
	p.server = nil
	p.public = nil
	p.stop = nil
	if server != nil {
		// SSE handlers remove themselves under p.mu. Close asynchronously so a
		// final channel release cannot wait on a handler waiting for this lock.
		go func() { _ = server.Close() }()
	}
}

func (p *TryCloudflareProvider) serveHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	name := strings.TrimPrefix(r.URL.Path, "/")
	if name == "" {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
		w.WriteHeader(http.StatusOK)
		if r.Method == http.MethodGet {
			_, _ = w.Write([]byte(p.landingPage))
		}
		return
	}
	if name == "status" {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.WriteHeader(http.StatusOK)
		if r.Method == http.MethodGet {
			_, _ = w.Write([]byte("{\"protocol\":\"wharness.tunnel-status/v1\",\"status\":\"ok\"}\n"))
		}
		return
	}
	if name == tryCloudflareReadinessPath {
		// Tunnel creation holds p.mu while it verifies the public round trip.
		// This deliberately absent route must therefore answer without reading
		// provider state or it would deadlock the readiness check.
		w.Header().Set("X-Wharness-Tunnel", "ready")
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if strings.Contains(name, "/") {
		p.serveChannelHTTP(w, r, name)
		return
	}
	if strings.Contains(name, "/") || validateObjectName(name) != nil {
		http.NotFound(w, r)
		return
	}
	p.mu.Lock()
	path, ok := p.objects[name]
	p.mu.Unlock()
	if !ok {
		http.NotFound(w, r)
		return
	}
	file, err := os.Open(path)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", `attachment; filename="`+name+`"`)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	http.ServeContent(w, r, name, info.ModTime(), file)
}
