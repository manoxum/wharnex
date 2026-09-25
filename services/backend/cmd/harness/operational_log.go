package main

import (
	"context"
	"fmt"
	"io"
	"log"
	"os"
	"time"

	"kernl.local/harness/backend/internal/audit"
	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/oplog"
	"kernl.local/harness/backend/internal/session"
)

// configureOperationalLog mirrors every audit event and every backend log line
// into the classified operational log, and runs its retention sweep
// (ADR-0075). The returned function flushes what is buffered.
func configureOperationalLog(store *session.Store, bus *audit.Bus) func() {
	writer := oplog.NewWriter(store, 4096)
	oplog.SetDefault(writer)
	bus.SetObserver(func(event domain.Event) { writer.Emit(oplog.FromEvent(event)) })
	log.SetOutput(io.MultiWriter(os.Stderr, writer.StdLog()))
	sweep := func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
		defer cancel()
		logs, events, err := store.PruneOperationalLog(ctx, time.Now().UTC())
		if err != nil {
			log.Printf("operational log retention sweep failed: %v", err)
			return
		}
		if logs > 0 || events > 0 {
			log.Printf("operational log retention sweep removed %d log records and %d ledger-noise events", logs, events)
		}
	}
	sweep()
	stop := make(chan struct{})
	go func() {
		ticker := time.NewTicker(time.Hour)
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
	return func() {
		close(stop)
		oplog.SetDefault(nil)
		bus.SetObserver(nil)
		log.SetOutput(os.Stderr)
		writer.Close()
		if dropped := writer.Dropped(); dropped > 0 {
			fmt.Fprintf(os.Stderr, "operational log dropped %d records at shutdown\n", dropped)
		}
	}
}
