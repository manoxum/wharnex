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
	flag.Parse()
	if strings.TrimSpace(*socket) == "" {
		fmt.Fprintln(os.Stderr, "terminal socket is required")
		os.Exit(2)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := sandbox.ServeHostPTYBridge(ctx, *socket); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
