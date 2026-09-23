package remoteinput

import (
	"context"
	"errors"
	"fmt"
	"net/netip"
	"os"
	"sync"

	"golang.zx2c4.com/wireguard/tun"
	"gvisor.dev/gvisor/pkg/buffer"
	"gvisor.dev/gvisor/pkg/tcpip"
	"gvisor.dev/gvisor/pkg/tcpip/adapters/gonet"
	"gvisor.dev/gvisor/pkg/tcpip/header"
	"gvisor.dev/gvisor/pkg/tcpip/link/channel"
	"gvisor.dev/gvisor/pkg/tcpip/network/ipv4"
	"gvisor.dev/gvisor/pkg/tcpip/stack"
	"gvisor.dev/gvisor/pkg/tcpip/transport/tcp"
)

const (
	pyjamasNIC        = tcpip.NICID(1)
	pyjamasMTU        = 1420
	pyjamasQueueDepth = 256
)

// userspaceNet is a wireguard-go tun.Device backed by a private gVisor network
// stack. It exists so the WireGuard data plane needs no host TUN device, no
// root and no NET_ADMIN: decrypted packets are delivered straight into this
// in-process stack, and the listener it fronts is never bound on a host
// interface at all.
type userspaceNet struct {
	endpoint *channel.Endpoint
	stack    *stack.Stack
	events   chan tun.Event
	ctx      context.Context
	cancel   context.CancelFunc
	closeAll sync.Once
}

func newUserspaceNet(address netip.Addr) (*userspaceNet, error) {
	if !address.Is4() {
		return nil, errors.New("userspace tunnel address must be IPv4")
	}
	networkStack := stack.New(stack.Options{
		NetworkProtocols:   []stack.NetworkProtocolFactory{ipv4.NewProtocol},
		TransportProtocols: []stack.TransportProtocolFactory{tcp.NewProtocol},
		HandleLocal:        true,
	})
	endpoint := channel.New(pyjamasQueueDepth, pyjamasMTU, "")
	if err := networkStack.CreateNIC(pyjamasNIC, endpoint); err != nil {
		networkStack.Close()
		return nil, fmt.Errorf("create userspace NIC: %v", err)
	}
	protocolAddress := tcpip.ProtocolAddress{
		Protocol:          ipv4.ProtocolNumber,
		AddressWithPrefix: tcpip.AddrFromSlice(address.AsSlice()).WithPrefix(),
	}
	if err := networkStack.AddProtocolAddress(pyjamasNIC, protocolAddress, stack.AddressProperties{}); err != nil {
		networkStack.Close()
		return nil, fmt.Errorf("assign userspace tunnel address: %v", err)
	}
	networkStack.SetRouteTable([]tcpip.Route{{Destination: header.IPv4EmptySubnet, NIC: pyjamasNIC}})
	ctx, cancel := context.WithCancel(context.Background())
	device := &userspaceNet{endpoint: endpoint, stack: networkStack, events: make(chan tun.Event, 1), ctx: ctx, cancel: cancel}
	device.events <- tun.EventUp
	return device, nil
}

// ListenTCP accepts connections inside the private stack. The returned
// listener has no host socket, so nothing on the machine or the LAN can reach
// it outside the WireGuard peering.
func (d *userspaceNet) ListenTCP(port uint16) (*gonet.TCPListener, error) {
	listener, err := gonet.ListenTCP(d.stack, tcpip.FullAddress{NIC: pyjamasNIC, Port: port}, ipv4.ProtocolNumber)
	if err != nil {
		return nil, fmt.Errorf("listen inside userspace tunnel: %w", err)
	}
	return listener, nil
}

// Read hands wireguard-go the packets this stack wants to send to the peer.
func (d *userspaceNet) Read(bufs [][]byte, sizes []int, offset int) (int, error) {
	if len(bufs) == 0 || len(sizes) < 1 {
		return 0, nil
	}
	packet := d.endpoint.ReadContext(d.ctx)
	if packet == nil {
		return 0, os.ErrClosed
	}
	defer packet.DecRef()
	view := packet.ToView()
	read, err := view.Read(bufs[0][offset:])
	if err != nil {
		return 0, err
	}
	sizes[0] = read
	return 1, nil
}

// Write injects packets wireguard-go decrypted from the peer. Anything that is
// not IPv4 is dropped rather than handed to the stack.
func (d *userspaceNet) Write(bufs [][]byte, offset int) (int, error) {
	written := 0
	for _, raw := range bufs {
		if offset > len(raw) {
			continue
		}
		datagram := raw[offset:]
		if len(datagram) == 0 || header.IPVersion(datagram) != header.IPv4Version {
			continue
		}
		packet := stack.NewPacketBuffer(stack.PacketBufferOptions{Payload: buffer.MakeWithData(datagram)})
		d.endpoint.InjectInbound(ipv4.ProtocolNumber, packet)
		packet.DecRef()
		written++
	}
	return written, nil
}

func (d *userspaceNet) MTU() (int, error)        { return pyjamasMTU, nil }
func (d *userspaceNet) Name() (string, error)    { return "wharnex-pyjamas", nil }
func (d *userspaceNet) File() *os.File           { return nil }
func (d *userspaceNet) Events() <-chan tun.Event { return d.events }
func (d *userspaceNet) BatchSize() int           { return 1 }

func (d *userspaceNet) Close() error {
	d.closeAll.Do(func() {
		d.cancel()
		d.endpoint.Close()
		d.stack.Close()
		close(d.events)
	})
	return nil
}
