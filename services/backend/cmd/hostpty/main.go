package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"kernl.local/harness/backend/internal/sandbox"
)

func main() {
	socket := flag.String("socket", os.Getenv("HARNESS_HOST_PTY_SOCKET"), "absolute Unix socket path for the optional PTY bridge")
	gitSocket := flag.String("git-socket", os.Getenv("HARNESS_HOST_GIT_SOCKET"), "absolute Unix socket path for restricted host Git operations")
	flag.Parse()
	if strings.TrimSpace(*socket) == "" && strings.TrimSpace(*gitSocket) == "" {
		fmt.Fprintln(os.Stderr, "at least one host bridge socket is required")
		os.Exit(2)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	servers := make([]func() error, 0, 2)
	if strings.TrimSpace(*socket) != "" {
		servers = append(servers, func() error { return sandbox.ServeHostPTYBridge(ctx, *socket) })
	}
	if strings.TrimSpace(*gitSocket) != "" {
		servers = append(servers, func() error { return sandbox.ServeHostGitBridge(ctx, *gitSocket) })
	}
	errors := make(chan error, len(servers))
	for _, serve := range servers {
		go func(run func() error) { errors <- run() }(serve)
	}
	if err := <-errors; err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
