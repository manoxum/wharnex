package remoteinput

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// NewPyjamasTunnelProvider publishes the loopback object server through
// tunnel.pyjam.as. The service documents `wg-quick up ./tunnel.conf`, which
// Wharnex deliberately does not use: that command needs root and NET_ADMIN and
// executes the remote document's PostUp hook as a shell string. The WireGuard
// data plane runs unprivileged in this process instead, and the document is
// only ever parsed as data.
func NewPyjamasTunnelProvider(storageDir string, landing TunnelLanding) (*TryCloudflareProvider, error) {
	return newPyjamasTunnelProvider(storageDir, landing, pyjamasStarter{configPath: filepath.Join(storageDir, pyjamasConfigFileName)})
}

func newPyjamasTunnelProvider(storageDir string, landing TunnelLanding, starter pyjamasStarter) (*TryCloudflareProvider, error) {
	if starter.configPath == "" {
		starter.configPath = filepath.Join(storageDir, pyjamasConfigFileName)
	}
	if err := starter.load(); err != nil {
		return nil, err
	}
	listenAddr := "127.0.0.1:0"
	if starter.cached != nil {
		listenAddr = "127.0.0.1:" + strconv.Itoa(starter.cached.localPort)
	}
	return newTunnelProvider(storageDir, "pyjamas", listenAddr, false, starter, landing, func(public *url.URL) bool {
		return public != nil && public.Scheme == "https" && public.User == nil &&
			strings.HasSuffix(strings.ToLower(public.Hostname()), "."+pyjamasHost)
	})
}

type pyjamasStopper func()
type pyjamasForward func(context.Context, pyjamasConfig, uint16, string) (pyjamasStopper, error)
type pyjamasProvision func(context.Context, *http.Client, int) (pyjamasConfig, string, error)

type pyjamasStarter struct {
	configPath string
	cached     *pyjamasConfig
	forward    pyjamasForward
	provision  pyjamasProvision
	ready      func(context.Context, *url.URL) error
}

func (s *pyjamasStarter) load() error {
	parsed, found, err := loadPyjamasConfig(s.configPath)
	if err != nil || !found {
		return err
	}
	s.cached = &parsed
	return nil
}

// Start publishes origin and returns the public HTTPS URL plus a stop function
// that tears the userspace tunnel down.
func (s pyjamasStarter) Start(ctx context.Context, origin string) (*url.URL, func(), error) {
	target, err := url.Parse(origin)
	if err != nil || target.Host == "" {
		return nil, nil, errors.New("pyjam.as requires a local origin to publish")
	}
	port, err := strconv.Atoi(target.Port())
	if err != nil || port < 1024 || port > 65535 {
		return nil, nil, errors.New("pyjam.as requires a bounded local port")
	}
	client := &http.Client{
		Timeout: 30 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return errors.New("pyjam.as redirected the provisioning request")
		},
	}
	forward := s.forward
	if forward == nil {
		forward = defaultPyjamasForward
	}
	ready := s.ready
	if ready == nil {
		ready = waitQuickTunnelReachable
	}
	parsed := s.cached
	for attempt := 0; attempt < 2; attempt++ {
		if parsed == nil {
			provision := s.provision
			if provision == nil {
				provision = fetchPyjamasConfigDocument
			}
			fetched, raw, err := provision(ctx, client, port)
			if err != nil {
				return nil, nil, err
			}
			if err := savePyjamasConfig(s.configPath, raw); err != nil {
				return nil, nil, err
			}
			parsed = &fetched
		}
		if parsed.localPort != port {
			return nil, nil, errors.New("pyjam.as saved tunnel config is for a different local port")
		}
		stop, err := forward(ctx, *parsed, uint16(port), target.Host)
		if err != nil {
			return nil, nil, err
		}
		probeCtx, cancel := context.WithTimeout(ctx, 12*time.Second)
		err = ready(probeCtx, parsed.public)
		cancel()
		if err == nil {
			return parsed.public, stop, nil
		}
		stop()
		if attempt == 1 {
			return nil, nil, fmt.Errorf("verify pyjam.as tunnel: %w", err)
		}
		if err := removePyjamasConfig(s.configPath); err != nil {
			return nil, nil, err
		}
		parsed = nil
	}
	return nil, nil, errors.New("pyjam.as tunnel could not be started")
}

func defaultPyjamasForward(ctx context.Context, parsed pyjamasConfig, port uint16, loopback string) (pyjamasStopper, error) {
	forwarder, err := startPyjamasForwarder(ctx, parsed, port, loopback)
	if err != nil {
		return nil, err
	}
	return forwarder.stop, nil
}
