package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"kernl.local/harness/backend/internal/app"
	"kernl.local/harness/backend/internal/artifactstore"
	"kernl.local/harness/backend/internal/audit"
	"kernl.local/harness/backend/internal/config"
	contextbundle "kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/orchestrator"
	"kernl.local/harness/backend/internal/pendingcommit"
	"kernl.local/harness/backend/internal/planner"
	"kernl.local/harness/backend/internal/planner/manual"
	openaiadapter "kernl.local/harness/backend/internal/planner/openai"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/remoteinput"
	"kernl.local/harness/backend/internal/sandbox"
	"kernl.local/harness/backend/internal/sandboxenv"
	"kernl.local/harness/backend/internal/session"
	"kernl.local/harness/backend/internal/transport/httpapi"
	"kernl.local/harness/backend/internal/tunneldaemon"
	utilityopenai "kernl.local/harness/backend/internal/utility/openai"
)

func main() {
	cfg := config.Load()
	if cfg.DatabaseURL == "" {
		log.Fatal("HARNESS_DATABASE_URL is required; start Wharness with the canonical Docker-backed lifecycle")
	}
	storeCtx, storeCancel := context.WithTimeout(context.Background(), 30*time.Second)
	store, err := session.NewPostgresStore(storeCtx, cfg.DatabaseURL, cfg.StateFile)
	storeCancel()
	if err != nil {
		log.Fatalf("session store: %v", err)
	}
	defer store.Close()
	orchestratorCtx, orchestratorCancel := context.WithTimeout(context.Background(), 30*time.Second)
	orchestratorStore, err := orchestrator.NewPostgresStore(orchestratorCtx, cfg.DatabaseURL)
	orchestratorCancel()
	if err != nil {
		log.Fatalf("orchestrator store: %v", err)
	}
	defer orchestratorStore.Close()
	bus := audit.NewPersistentBus(store)
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
		runner = sandbox.NewDockerRunnerWithDependencyCache(cfg.RunnerImage, cfg.DependencyCacheDir)
	}

	service := app.NewService(store, bus, builder, p, policies, runner)
	if cfg.OpenAIAPIKey != "" {
		service.SetUtilityEngine(utilityopenai.New(cfg.OpenAIAPIKey, cfg.OpenAIUtilityModel, cfg.OpenAIBaseURL))
	}
	service.SetOrchestratorStore(orchestratorStore)
	service.SetGitSurface(cfg.GitSettingsFile, pendingcommit.NewStore(cfg.GitPendingCommitsFile))
	service.SetRuntimeInstanceID(cfg.InstanceID)
	service.SetEnvironmentProber(sandboxenv.NewProber(cfg.RunnerImage, cfg.Sandbox))
	stopArtifacts := configureArtifactStore(cfg, service)
	defer stopArtifacts()
	stopChatArchive := configureChatArchive(cfg, service)
	defer stopChatArchive()
	service.SetRemoteStorageConnector(remoteinput.NewRcloneConnector())
	remoteStore, cleanupRemote, stopRemote := configureRemoteInputs(cfg, service)
	service.SetRemoteInputStore(remoteStore)
	defer stopRemote()
	cleanupRemote()
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

func configureRemoteInputs(cfg config.Config, service *app.Service) (app.RemoteInputStore, func(), func()) {
	var store app.RemoteInputStore
	var session app.RemoteInputSessionStore
	var cleanup func(context.Context, time.Time) error
	if cfg.Tunnel.DaemonURL != "" {
		client, err := tunneldaemon.NewClient(cfg.Tunnel.DaemonURL, cfg.Tunnel.DaemonToken)
		if err != nil {
			log.Fatalf("tunnel daemon client: %v", err)
		}
		probeCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		providers, err := client.Providers(probeCtx)
		cancel()
		if err != nil {
			log.Fatalf("tunnel daemon providers: %v", err)
		}
		service.SetTunnelProviders(providers)
		service.SetTunnelProviderConnector(client)
		store, session, cleanup = client, client, client.Cleanup
	} else {
		manager, err := remoteinput.NewTunnelManager(cfg.Tunnel)
		if err != nil {
			log.Fatalf("remote storage configuration: %v", err)
		}
		service.SetTunnelProviders(remoteinput.TunnelProviders())
		service.SetTunnelProviderConnector(remoteinput.NewTunnelConnector(cfg.Tunnel.SecretsDir))
		store, session, cleanup = manager, manager, manager.Cleanup
	}
	startCtx, startCancel := context.WithTimeout(context.Background(), 2*time.Minute)
	if err := session.StartRemoteInputSession(startCtx); err != nil {
		startCancel()
		log.Fatalf("tunnel session start: %v", err)
	}
	startCancel()
	cleanupRemote := func() {
		if !store.Status().Enabled {
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		defer cancel()
		if err := cleanup(ctx, time.Now().UTC().Add(-app.RemoteInputRetention)); err != nil {
			log.Printf("remote storage retention cleanup failed: %v", err)
		}
	}
	stopRemote := func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := session.StopRemoteInputSession(ctx); err != nil {
			log.Printf("remote input session close failed: %v", err)
		}
	}
	return store, cleanupRemote, stopRemote
}

// tunnelInputManager remains a narrow compatibility helper for package-level
// tests and non-daemon development paths. Production stack mode uses the
// tunnel daemon client above.
func tunnelInputManager(cfg config.TunnelConfig) (*remoteinput.Manager, error) {
	return remoteinput.NewTunnelManager(cfg)
}

func configureArtifactStore(cfg config.Config, service *app.Service) func() {
	settings, err := config.ReadArtifactSettings(cfg.Artifacts)
	if err != nil {
		log.Fatalf("artifact settings: %v", err)
	}
	store, err := artifactstore.NewMinIO(artifactstore.Config{Endpoint: cfg.Artifacts.Endpoint, AccessKey: cfg.Artifacts.AccessKey, SecretKey: cfg.Artifacts.SecretKey, Bucket: cfg.Artifacts.Bucket, Region: cfg.Artifacts.Region})
	if err != nil {
		log.Fatalf("artifact store: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	if err := store.EnsureBucket(ctx); err != nil {
		cancel()
		log.Fatalf("artifact bucket: %v", err)
	}
	cancel()
	service.SetArtifactStore(store, settings.RetentionDays)
	service.SetBundleWindowLimit(settings.BundleWindowLimit)
	cleanup := func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
		defer cancel()
		before := time.Now().UTC().Add(-time.Duration(service.ArtifactSettings().RetentionDays) * 24 * time.Hour)
		if err := service.CleanupArtifacts(ctx, before); err != nil {
			log.Printf("artifact retention cleanup failed: %v", err)
		}
	}
	cleanup()
	stop := make(chan struct{})
	go func() {
		ticker := time.NewTicker(12 * time.Hour)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				cleanup()
			case <-stop:
				return
			}
		}
	}()
	return func() { close(stop) }
}

// configureChatArchive wires the passive chat-archive compaction sweep
// (ADR-0031). It must run after configureArtifactStore: compaction depends
// on the artifact store already being set.
func configureChatArchive(cfg config.Config, service *app.Service) func() {
	sweep := func() {
		// Generous timeout: strictly-sequential, throttled processing of
		// many due sessions in one sweep can legitimately take a while.
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
		defer cancel()
		cutoff := time.Now().UTC().Add(-time.Duration(cfg.ChatArchive.GraceHours) * time.Hour)
		if err := service.CompactArchivedChats(ctx, cutoff); err != nil {
			log.Printf("chat archive compaction failed: %v", err)
		}
	}
	sweep()
	stop := make(chan struct{})
	go func() {
		ticker := time.NewTicker(time.Duration(cfg.ChatArchive.SweepIntervalMinutes) * time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				sweep()
			case <-stop:
				return
			}
		}
	}()
	return func() { close(stop) }
}
