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
	"kernl.local/harness/backend/internal/audit"
	"kernl.local/harness/backend/internal/config"
	contextbundle "kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/planner"
	"kernl.local/harness/backend/internal/planner/manual"
	openaiadapter "kernl.local/harness/backend/internal/planner/openai"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/sandbox"
	"kernl.local/harness/backend/internal/session"
	"kernl.local/harness/backend/internal/transport/httpapi"
)

func main() {
	cfg := config.Load()
	bus := audit.NewBus()
	store := session.NewStore()
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
