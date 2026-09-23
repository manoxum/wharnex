package remoteinput

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/netip"
	"sync"
	"time"

	"golang.zx2c4.com/wireguard/conn"
	"golang.zx2c4.com/wireguard/device"
)

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
	settings := fmt.Sprintf("private_key=%s\npublic_key=%s\nendpoint=%s\nallowed_ip=%s\npersistent_keepalive_interval=%d\n", parsed.privateKey, parsed.peerPublicKey, endpoint, parsed.allowedIP, parsed.keepalive)
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

func (f *pyjamasForwarder) proxy(remote net.Conn, loopback string) {
	defer remote.Close()
	local, err := net.DialTimeout("tcp", loopback, 10*time.Second)
	if err != nil {
		return
	}
	defer local.Close()
	done := make(chan struct{})
	go func() { defer close(done); _, _ = io.Copy(local, remote) }()
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
