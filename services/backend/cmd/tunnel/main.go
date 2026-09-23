package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"kernl.local/harness/backend/internal/config"
	"kernl.local/harness/backend/internal/remoteinput"
	"kernl.local/harness/backend/internal/tunneldaemon"
)

func main() {
	addr := env("WHARNESS_TUNNEL_ADDR", ":8090")
	stateDir := env("WHARNESS_TUNNEL_STATE_DIR", "/var/lib/wharness-tunnel")
	bridgeDir := env("WHARNESS_BRIDGE_DIR", "/bridge")
	token := os.Getenv("WHARNESS_TUNNEL_API_TOKEN")
	if token == "" {
		log.Fatal("WHARNESS_TUNNEL_API_TOKEN is required")
	}
	if err := os.MkdirAll(stateDir, 0o700); err != nil {
		log.Fatalf("tunnel state: %v", err)
	}
	cfg := config.TunnelConfig{
		RemoteAppOrigin:   os.Getenv("WHARNESS_REMOTE_APP_ORIGIN"),
		ConfigFile:        env("HARNESS_TUNNEL_CONFIG_FILE", "/control/tunnel-providers.json"),
		IndexFile:         filepath.Join(stateDir, "usage.json"),
		SecretsDir:        filepath.Join(stateDir, "credentials"),
		LegacyStorageFile: env("HARNESS_REMOTE_STORAGE_CONFIG_FILE", "/control/remote-storage.json"),
		LegacyProvider:    os.Getenv("HARNESS_REMOTE_STORAGE_PROVIDER"),
	}
	// A configuration that cannot be built must not take the daemon down with
	// it: correcting it is done by saving again, which needs this daemon alive
	// to receive the reload. Serve an empty pool and report why.
	manager, err := remoteinput.NewTunnelManager(cfg)
	if err != nil {
		log.Printf("tunnel configuration rejected, serving no tunnels until it is corrected: %v", err)
		manager = remoteinput.NewDegradedTunnelManager(cfg)
	}
	connector := remoteinput.NewTunnelConnector(cfg.SecretsDir)
	api, err := tunneldaemon.NewServer(manager, connector, remoteinput.TunnelProviders(), bridgeDir)
	if err != nil {
		log.Fatalf("tunnel daemon: %v", err)
	}
	// A provider failing to connect is an operational condition, not a reason
	// to kill the daemon. Exiting here would crash-loop the container under
	// `restart: unless-stopped` and take the whole tunnel service down —
	// including the endpoints the UI needs to show *why* it is unavailable.
	// Each failed instance is already recorded as unavailable with its reason.
	startCtx, startCancel := context.WithTimeout(context.Background(), 2*time.Minute)
	if err := manager.StartRemoteInputSession(startCtx); err != nil {
		log.Printf("tunnel session start: %v", err)
	}
	startCancel()
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := manager.StopRemoteInputSession(ctx); err != nil {
			log.Printf("tunnel session stop: %v", err)
		}
	}()

	server := &http.Server{Addr: addr, Handler: api.Handler(token), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 30 * time.Second, WriteTimeout: 30 * time.Minute, IdleTimeout: 60 * time.Second}
	go func() {
		log.Printf("wharness tunnel daemon listening on %s", addr)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("tunnel daemon HTTP: %v", err)
		}
	}()
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(ctx); err != nil {
		log.Printf("tunnel daemon shutdown: %v", err)
	}
}

func env(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}
