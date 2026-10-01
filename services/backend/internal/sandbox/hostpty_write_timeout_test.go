package sandbox

import (
	"encoding/json"
	"net"
	"testing"
	"time"
)

func TestHostPTYInputDoesNotHangWhenDaemonStopsReading(t *testing.T) {
	client, daemon := net.Pipe()
	defer daemon.Close()
	exited := make(chan error, 1)
	terminal := &bridgedHostTerminal{conn: client, encoder: json.NewEncoder(client), onExit: func(_ int, err error) { exited <- err }}
	start := time.Now()
	err := terminal.Write([]byte("a"))
	if timeout, ok := err.(net.Error); !ok || !timeout.Timeout() {
		t.Fatalf("write error = %v, want timeout", err)
	}
	if time.Since(start) > hostPTYWriteTimeout+time.Second {
		t.Fatal("input remained blocked after its deadline")
	}
	select {
	case <-exited:
	default:
		t.Fatal("timed out transport did not notify terminal exit")
	}
}
