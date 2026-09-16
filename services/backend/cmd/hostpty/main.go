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
	socket := flag.String("socket", os.Getenv("HARNESS_HOST_PTY_SOCKET"), "absolute Unix socket path shared with the backend")
	gitSocket := flag.String("git-socket", os.Getenv("HARNESS_HOST_GIT_SOCKET"), "absolute Unix socket path for restricted host Git operations")
	flag.Parse()
	if strings.TrimSpace(*socket) == "" || strings.TrimSpace(*gitSocket) == "" {
		fmt.Fprintln(os.Stderr, "host PTY and Git bridge sockets are required")
		os.Exit(2)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	errors := make(chan error, 2)
	go func() { errors <- sandbox.ServeHostPTYBridge(ctx, *socket) }()
	go func() { errors <- sandbox.ServeHostGitBridge(ctx, *gitSocket) }()
	if err := <-errors; err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
