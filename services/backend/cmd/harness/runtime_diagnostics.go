package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/http/pprof"
	"os"
	"runtime"
	"runtime/debug"
	"strconv"
	"strings"
	"time"
)

// Runtime memory governance and diagnostics for the backend process.
//
// WHARNEX_BACKEND_MEMORY_LIMIT_MB sets the Go soft memory limit for this
// process only. It is applied through debug.SetMemoryLimit rather than the
// GOMEMLIMIT variable because the backend spawns Go toolchains (self-evolution
// builds, host verification) that would otherwise inherit a limit sized for
// the engine.
//
// WHARNEX_RUNTIME_STATS_INTERVAL logs heap and goroutine figures on a fixed
// cadence so growth can be followed live from `make logs`.
//
// WHARNEX_PPROF_ADDR serves net/http/pprof on its own listener. It is refused
// unless it binds a loopback address: inside the stack that makes it
// reachable only through `docker exec`, never through the gateway.
func configureRuntimeDiagnostics() func() {
	if limit := envInt("WHARNEX_BACKEND_MEMORY_LIMIT_MB"); limit > 0 {
		debug.SetMemoryLimit(int64(limit) << 20)
		log.Printf("runtime memory limit set to %d MiB", limit)
	}
	ctx, cancel := context.WithCancel(context.Background())
	if interval, err := time.ParseDuration(strings.TrimSpace(os.Getenv("WHARNEX_RUNTIME_STATS_INTERVAL"))); err == nil && interval > 0 {
		go logRuntimeStats(ctx, interval)
	}
	stopProfiler := startProfiler(strings.TrimSpace(os.Getenv("WHARNEX_PPROF_ADDR")))
	return func() {
		cancel()
		stopProfiler()
	}
}

func envInt(name string) int {
	value, err := strconv.Atoi(strings.TrimSpace(os.Getenv(name)))
	if err != nil {
		return 0
	}
	return value
}

func logRuntimeStats(ctx context.Context, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			log.Print(runtimeStatsLine())
		}
	}
}

func runtimeStatsLine() string {
	var stats runtime.MemStats
	runtime.ReadMemStats(&stats)
	const mib = 1 << 20
	return fmt.Sprintf("runtime stats heap_alloc_mib=%d heap_inuse_mib=%d heap_idle_mib=%d heap_released_mib=%d sys_mib=%d goroutines=%d gc=%d",
		stats.HeapAlloc/mib, stats.HeapInuse/mib, stats.HeapIdle/mib, stats.HeapReleased/mib, stats.Sys/mib, runtime.NumGoroutine(), stats.NumGC)
}

func startProfiler(addr string) func() {
	if addr == "" {
		return func() {}
	}
	if err := requireLoopback(addr); err != nil {
		log.Printf("pprof disabled: %v", err)
		return func() {}
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/debug/pprof/", pprof.Index)
	mux.HandleFunc("/debug/pprof/cmdline", pprof.Cmdline)
	mux.HandleFunc("/debug/pprof/profile", pprof.Profile)
	mux.HandleFunc("/debug/pprof/symbol", pprof.Symbol)
	mux.HandleFunc("/debug/pprof/trace", pprof.Trace)
	server := &http.Server{Addr: addr, Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	go func() {
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("pprof listener stopped: %v", err)
		}
	}()
	log.Printf("pprof listening on %s (loopback only)", addr)
	return func() { _ = server.Close() }
}

func requireLoopback(addr string) error {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return fmt.Errorf("invalid address %q: %w", addr, err)
	}
	if host == "localhost" {
		return nil
	}
	if ip := net.ParseIP(host); ip != nil && ip.IsLoopback() {
		return nil
	}
	return fmt.Errorf("address %q is not loopback", addr)
}
