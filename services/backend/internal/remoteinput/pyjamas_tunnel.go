package remoteinput

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.zx2c4.com/wireguard/conn"
	"golang.zx2c4.com/wireguard/device"
)

// NewPyjamasTunnelProvider publishes the loopback object server through
// tunnel.pyjam.as. The service documents `wg-quick up ./tunnel.conf`, which
// Wharnex deliberately does not use: that command needs root and NET_ADMIN and
// executes the remote document's PostUp hook as a shell string. The WireGuard
// data plane runs unprivileged in this process instead, and the document is
// only ever parsed as data.
func NewPyjamasTunnelProvider(storageDir string, landing TunnelLanding) (*TryCloudflareProvider, error) {
	return newTunnelProvider(storageDir, "pyjamas", "127.0.0.1:0", false, pyjamasStarter{}, landing, func(public *url.URL) bool {
		return public != nil && public.Scheme == "https" && public.User == nil &&
			strings.HasSuffix(strings.ToLower(public.Hostname()), "."+pyjamasHost)
	})
}

type pyjamasStarter struct{}

// Start publishes origin and returns the public HTTPS URL plus a stop function
// that tears the userspace tunnel down.
func (pyjamasStarter) Start(ctx context.Context, origin string) (*url.URL, func(), error) {
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
	// The stack is private to this process, so the published port number can
	// simply mirror the loopback listener it fronts.
	parsed, err := fetchPyjamasConfig(ctx, client, port)
	if err != nil {
		return nil, nil, err
	}
	forwarder, err := startPyjamasForwarder(ctx, parsed, uint16(port), target.Host)
	if err != nil {
		return nil, nil, err
	}
	return parsed.public, forwarder.stop, nil
}

type pyjamasForwarder struct {
	net      *userspaceNet
	device   *device.Device
	closeAll sync.Once
}

func startPyjamasForwarder(ctx context.Context, parsed pyjamasConfig, port uint16, loopback string) (*pyjamasForwarder, error) {
	endpoint, err := resolvePyjamasEndpoint(ctx, parsed)
	if err != nil {
		return nil, err
	}
	userspace, err := newUserspaceNet(parsed.address)
	if err != nil {
		return nil, err
	}
	wireguard := device.NewDevice(userspace, conn.NewDefaultBind(), device.NewLogger(device.LogLevelSilent, ""))
	forwarder := &pyjamasForwarder{net: userspace, device: wireguard}
	settings := fmt.Sprintf("private_key=%s\npublic_key=%s\nendpoint=%s\nallowed_ip=%s\npersistent_keepalive_interval=%d\n",
		parsed.privateKey, parsed.peerPublicKey, endpoint, parsed.allowedIP, parsed.keepalive)
	if err := wireguard.IpcSet(settings); err != nil {
		forwarder.stop()
		return nil, fmt.Errorf("configure pyjam.as tunnel: %w", err)
	}
	if err := wireguard.Up(); err != nil {
		forwarder.stop()
		return nil, fmt.Errorf("start pyjam.as tunnel: %w", err)
	}
	listener, err := userspace.ListenTCP(port)
	if err != nil {
		forwarder.stop()
		return nil, err
	}
	go forwarder.accept(listener, loopback)
	return forwarder, nil
}

// resolvePyjamasEndpoint resolves the validated service hostname itself because
// the WireGuard bind accepts only a literal address and port.
func resolvePyjamasEndpoint(ctx context.Context, parsed pyjamasConfig) (netip.AddrPort, error) {
	resolveCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	addresses, err := net.DefaultResolver.LookupNetIP(resolveCtx, "ip4", parsed.endpointHost)
	if err != nil || len(addresses) == 0 {
		return netip.AddrPort{}, fmt.Errorf("resolve %s: %w", parsed.endpointHost, err)
	}
	return netip.AddrPortFrom(addresses[0].Unmap(), uint16(parsed.endpointPort)), nil
}

func (f *pyjamasForwarder) accept(listener net.Listener, loopback string) {
	defer listener.Close()
	for {
		remote, err := listener.Accept()
		if err != nil {
			return
		}
		go f.proxy(remote, loopback)
	}
}

// proxy joins one tunnelled connection to the loopback object server. The
// object server keeps owning every routing and authorization decision; this
// only moves bytes.
func (f *pyjamasForwarder) proxy(remote net.Conn, loopback string) {
	defer remote.Close()
	local, err := net.DialTimeout("tcp", loopback, 10*time.Second)
	if err != nil {
		return
	}
	defer local.Close()
	done := make(chan struct{})
	go func() {
		defer close(done)
		_, _ = io.Copy(local, remote)
	}()
	_, _ = io.Copy(remote, local)
	<-done
}

func (f *pyjamasForwarder) stop() {
	f.closeAll.Do(func() {
		if f.device != nil {
			f.device.Close()
		}
		if f.net != nil {
			f.net.Close()
		}
	})
}
