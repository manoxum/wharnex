package selfevolution

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

func persistentSelfEvolutionPhase(phase string) bool {
	switch phase {
	case "restart_pending", "restart_failed", "restart_scheduled", "restarting", "rollback_runtime", "rollback_restored", "rollback_deps", "rollback_failed":
		return true
	default:
		return false
	}
}

func acquireLock(path string) error {
	file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err == nil {
		// run_id is what makes this lock reclaimable after a crash or
		// restart: activeLockOwnerAlive can only recognize a lock as stale
		// when it can tell which runtime instance wrote it. A pid alone is
		// useless here (the backend is PID 1 in its container).
		_, _ = fmt.Fprintf(file, "pid=%d\nrun_id=%s\ncreated=%s\n", os.Getpid(), runtimeInstanceID, time.Now().UTC().Format(time.RFC3339Nano))
		return file.Close()
	}
	if !errors.Is(err, os.ErrExist) {
		return err
	}
	if !activeLockOwnerAlive(path) {
		_ = os.Remove(path)
		return acquireLock(path)
	}
	return ErrBusy
}

func transactionID() string {
	var raw [6]byte
	if _, err := rand.Read(raw[:]); err == nil {
		return time.Now().UTC().Format("20060102T150405") + "-" + hex.EncodeToString(raw[:])
	}
	return fmt.Sprintf("%d", time.Now().UTC().UnixNano())
}

type limitedBuffer struct {
	mu        sync.Mutex
	head      bytes.Buffer
	tail      []byte
	truncated bool
}

func (b *limitedBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	const limit = 512 * 1024
	// Build output often starts with dependency hydration and thousands of
	// passing test lines. Retaining only that prefix used to discard the final
	// compiler/runtime diagnostic -- precisely the part needed to classify a
	// failed self-evolution Apply. Keep enough provenance at the start and a
	// much larger rolling tail containing the terminal failure instead.
	const headLimit = 64 * 1024
	const tailLimit = limit - headLimit
	original := len(p)
	if b.head.Len() < headLimit {
		remaining := headLimit - b.head.Len()
		if remaining > len(p) {
			remaining = len(p)
		}
		_, _ = b.head.Write(p[:remaining])
		p = p[remaining:]
	}
	if len(p) > 0 {
		b.tail = append(b.tail, p...)
		if len(b.tail) > tailLimit {
			b.tail = append([]byte(nil), b.tail[len(b.tail)-tailLimit:]...)
			b.truncated = true
		}
	}
	return original, nil
}

func (b *limitedBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	if !b.truncated {
		return b.head.String() + string(b.tail)
	}
	return b.head.String() + "\n...[middle build output truncated by Wharnex; terminal output retained]...\n" + string(b.tail)
}

func copyFile(source, destination string, mode os.FileMode) error {
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()
	if err := os.MkdirAll(filepath.Dir(destination), 0o700); err != nil {
		return err
	}
	output, err := os.OpenFile(destination, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, mode.Perm())
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(output, input)
	closeErr := output.Close()
	if copyErr != nil {
		return copyErr
	}
	return closeErr
}

func uniqueSorted(values map[string]struct{}) []string {
	out := make([]string, 0, len(values))
	for value := range values {
		out = append(out, value)
	}
	sort.Strings(out)
	return out
}
