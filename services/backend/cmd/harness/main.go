package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"kernl.local/harness/backend/internal/app"
	"kernl.local/harness/backend/internal/audit"
	"kernl.local/harness/backend/internal/config"
	contextbundle "kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/planner"
	"kernl.local/harness/backend/internal/planner/manual"
	openaiadapter "kernl.local/harness/backend/internal/planner/openai"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/remoteinput"
	"kernl.local/harness/backend/internal/sandbox"
	"kernl.local/harness/backend/internal/session"
	"kernl.local/harness/backend/internal/transport/httpapi"
)

func main() {
	cfg := config.Load()
	bus := audit.NewBus()
	store, err := session.NewPersistentStore(cfg.StateFile)
	if err != nil {
		log.Fatalf("session store: %v", err)
	}
	builder := contextbundle.NewBuilder(cfg.MaxContextBytes, cfg.MaxBundleBytes)
	policies := policy.NewEngine()

	var p planner.Planner
	switch cfg.Planner {
	case "openai":
		if cfg.OpenAIAPIKey == "" {
			log.Fatal("HARNESS_PLANNER=openai requires OPENAI_API_KEY")
		}
		p = openaiadapter.New(cfg.OpenAIAPIKey, cfg.OpenAIModel, cfg.OpenAIBaseURL)
	default:
		p = manual.New()
	}

	var runner sandbox.Runner
	if cfg.Sandbox == "local" {
		if !cfg.AllowLocalSandbox {
			log.Fatal("local sandbox refused: set HARNESS_ALLOW_LOCAL_SANDBOX=true only for trusted development")
		}
		runner = sandbox.NewLocalRunner()
	} else {
		runner = sandbox.NewDockerRunner(cfg.RunnerImage)
	}

	service := app.NewService(store, bus, builder, p, policies, runner)
	service.SetRemoteStorageConnector(remoteinput.NewRcloneConnector())
	remoteManager, err := remoteInputManager(cfg.RemoteStorage)
	if err != nil {
		log.Fatalf("remote storage configuration: %v", err)
	}
	service.SetRemoteInputStore(remoteManager)
	if remoteManager.Status().Enabled {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		if err := remoteManager.Cleanup(cleanupCtx, time.Now().UTC().Add(-app.RemoteInputRetention)); err != nil {
			log.Printf("remote storage retention cleanup failed: %v", err)
		}
		cancel()
	}
	handler := httpapi.New(service, store, bus, cfg)
	server := &http.Server{
		Addr:              cfg.Addr,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Minute,
		IdleTimeout:       60 * time.Second,
	}

	go func() {
		log.Printf("kernl backend listening on %s planner=%s sandbox=%s", cfg.Addr, cfg.Planner, cfg.Sandbox)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("http server: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(ctx); err != nil {
		log.Printf("shutdown: %v", err)
	}
}

func remoteInputManager(cfg config.RemoteStorageConfig) (*remoteinput.Manager, error) {
	configs, err := config.LoadRemoteStorageInstances(cfg)
	if err != nil {
		return nil, err
	}
	instances := make([]remoteinput.Instance, 0, len(configs))
	for _, instanceConfig := range configs {
		provider, err := remoteInputProvider(instanceConfig)
		if err != nil {
			return nil, fmt.Errorf("remote storage instance %s: %w", instanceConfig.ID, err)
		}
		instances = append(instances, remoteinput.Instance{ID: instanceConfig.ID, Priority: instanceConfig.Priority, Limits: instanceConfig.Limits, Provider: provider})
	}
	return remoteinput.NewPool(instances, cfg.IndexFile), nil
}

func remoteInputProvider(cfg config.RemoteStorageInstanceConfig) (remoteinput.Provider, error) {
	switch strings.ToLower(strings.TrimSpace(cfg.Provider)) {
	case "http":
		return remoteinput.NewHTTPProvider(remoteinput.HTTPConfig{UploadBaseURL: cfg.UploadURL, PublicBaseURL: cfg.PublicURL, Authorization: cfg.Authorization})
	case "webdav":
		if strings.TrimSpace(cfg.RcloneRemote) == "" {
			return remoteinput.NewHTTPProvider(remoteinput.HTTPConfig{UploadBaseURL: cfg.UploadURL, PublicBaseURL: cfg.PublicURL, Authorization: cfg.Authorization})
		}
		return remoteinput.NewRcloneProvider(remoteinput.RcloneConfig{Remote: cfg.RcloneRemote, Prefix: cfg.RclonePrefix, PublicBaseURL: cfg.PublicURL, Provider: cfg.Provider})
	case "rclone", "drive", "dropbox", "onedrive", "s3", "nextcloud", "box", "pcloud":
		return remoteinput.NewRcloneProvider(remoteinput.RcloneConfig{Remote: cfg.RcloneRemote, Prefix: cfg.RclonePrefix, PublicBaseURL: cfg.PublicURL, Provider: cfg.Provider})
	default:
		return nil, errors.New("unsupported remote storage provider")
	}
}
