package selfevolution

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func sanitizeLabel(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "unknown"
	}
	var cleaned strings.Builder
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || strings.ContainsRune("._-", r) {
			cleaned.WriteRune(r)
		}
		if cleaned.Len() >= 180 {
			break
		}
	}
	if cleaned.Len() == 0 {
		return "unknown"
	}
	return cleaned.String()
}

func canonicalPath(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", errors.New("empty path")
	}
	abs, err := filepath.Abs(value)
	if err != nil {
		return "", err
	}
	resolved, err := filepath.EvalSymlinks(abs)
	if err != nil {
		return "", err
	}
	return filepath.Clean(resolved), nil
}

func ascendForRoot(start string) string {
	current, err := canonicalPath(start)
	if err != nil {
		return ""
	}
	for range 8 {
		if looksLikeWharness(current) {
			return current
		}
		parent := filepath.Dir(current)
		if parent == current {
			break
		}
		current = parent
	}
	return ""
}

func looksLikeWharness(root string) bool {
	for _, relative := range []string{"Makefile", "scripts/start.sh", "services/backend/go.mod", "services/desktop/package.json"} {
		if info, err := os.Stat(filepath.Join(root, relative)); err != nil || info.IsDir() {
			return false
		}
	}
	return true
}

func acquireActiveLock(path string) error {
	file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err == nil {
		_, _ = fmt.Fprintf(file, "pid=%d\nrun_id=%s\ncreated=%s\n", os.Getpid(), runtimeInstanceID, time.Now().UTC().Format(time.RFC3339Nano))
		return file.Close()
	}
	if errors.Is(err, os.ErrExist) {
		return ErrBusy
	}
	return err
}

func activeLockOwnerAlive(path string) bool {
	data, err := os.ReadFile(path)
	if err != nil {
		return false
	}
	for _, line := range strings.Split(string(data), "\n") {
		key, value, ok := strings.Cut(line, "=")
		if !ok || strings.TrimSpace(key) != "run_id" {
			continue
		}
		return strings.TrimSpace(value) == runtimeInstanceID
	}
	// No run_id: the lock predates run-id stamping, so its owner cannot be
	// this runtime instance. Its `pid` is deliberately NOT consulted: the
	// backend runs as PID 1 inside its own container, so a recorded `pid=1`
	// answers "alive" for every future backend process too and the lock can
	// never be reclaimed. That is not hypothetical — an orphaned stage.lock
	// holding `pid=1` blocked every self-evolution host apply for hours,
	// and because each blocked apply asks ChatGPT for a correction that
	// cannot possibly release a local lock file, it turned into an
	// unbounded request/repair ping-pong. Treat it as stale and let the
	// caller reclaim it.
	return false
}

func extendablePendingPhase(phase string) bool {
	return phase == "restart_pending" || phase == "restart_failed"
}
