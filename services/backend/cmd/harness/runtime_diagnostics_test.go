package main

import (
	"strings"
	"testing"
)

func TestProfilerRefusesNonLoopbackAddresses(t *testing.T) {
	for _, addr := range []string{"127.0.0.1:6060", "[::1]:6060", "localhost:6060"} {
		if err := requireLoopback(addr); err != nil {
			t.Fatalf("%s must be accepted: %v", addr, err)
		}
	}
	for _, addr := range []string{":6060", "0.0.0.0:6060", "10.90.4.2:6060", "backend:6060", "garbage"} {
		if err := requireLoopback(addr); err == nil {
			t.Fatalf("%s must be refused: pprof may never be reachable beyond the container", addr)
		}
	}
}

func TestRuntimeStatsLineReportsHeapAndGoroutines(t *testing.T) {
	line := runtimeStatsLine()
	for _, field := range []string{"heap_alloc_mib=", "heap_released_mib=", "goroutines=", "gc="} {
		if !strings.Contains(line, field) {
			t.Fatalf("runtime stats line lacks %s: %q", field, line)
		}
	}
}
