package oplog

import (
	"context"
	"fmt"
	"io"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// Store persists batches of records.
type Store interface {
	AppendOperationalLog(context.Context, []Record) error
}

// Writer is the asynchronous, bounded path from the engine to the store.
// Recording must never slow or fail the work it records: Emit never blocks,
// and a full buffer drops the record and counts it.
type Writer struct {
	store   Store
	records chan Record
	dropped atomic.Int64
	done    chan struct{}
	once    sync.Once
	now     func() time.Time
}

const batchSize = 200

func NewWriter(store Store, capacity int) *Writer {
	if capacity < batchSize {
		capacity = batchSize
	}
	w := &Writer{store: store, records: make(chan Record, capacity), done: make(chan struct{}), now: time.Now}
	go w.run()
	return w
}

// Emit enqueues a record without blocking.
func (w *Writer) Emit(record Record) {
	if w == nil {
		return
	}
	record.Normalize(w.now())
	select {
	case w.records <- record:
	default:
		w.dropped.Add(1)
	}
}

// Dropped reports how many records a full buffer discarded.
func (w *Writer) Dropped() int64 { return w.dropped.Load() }

// Close flushes what is buffered and stops the writer.
func (w *Writer) Close() {
	w.once.Do(func() { close(w.records) })
	<-w.done
}

func (w *Writer) run() {
	defer close(w.done)
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	batch := make([]Record, 0, batchSize)
	flush := func() {
		if len(batch) == 0 {
			return
		}
		if dropped := w.dropped.Swap(0); dropped > 0 {
			batch = append(batch, Record{Event: "oplog.records_dropped", Level: LevelWarning, Data: map[string]any{"dropped": dropped}})
			batch[len(batch)-1].Normalize(w.now())
		}
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		// Never through `log`: the standard logger is itself captured here.
		if err := w.store.AppendOperationalLog(ctx, batch); err != nil {
			fmt.Fprintf(os.Stderr, "operational log write failed (%d records): %v\n", len(batch), err)
		}
		cancel()
		batch = batch[:0]
	}
	for {
		select {
		case record, ok := <-w.records:
			if !ok {
				flush()
				return
			}
			batch = append(batch, record)
			if len(batch) >= batchSize {
				flush()
			}
		case <-ticker.C:
			flush()
		}
	}
}

// StdLog returns an io.Writer for the standard logger: every line the backend
// logs becomes a backend-log record.
func (w *Writer) StdLog() io.Writer { return stdLogWriter{w} }

type stdLogWriter struct{ w *Writer }

func (s stdLogWriter) Write(p []byte) (int, error) {
	for _, line := range strings.Split(strings.TrimRight(string(p), "\n"), "\n") {
		if line = strings.TrimSpace(line); line != "" {
			s.w.Emit(Record{Event: "backend-log", Component: "backend-log", Level: stdLogLevel(line), Message: line})
		}
	}
	return len(p), nil
}

func stdLogLevel(line string) string {
	lower := strings.ToLower(line)
	switch {
	case containsAny(lower, "failed", "error", "fatal", "panic", "refused"):
		return LevelError
	case containsAny(lower, "warning", "stale", "skipped", "retry"):
		return LevelWarning
	default:
		return LevelInfo
	}
}
