package gitops

import (
	"context"
	"encoding/json"
	"io"
	"net"
	"os"
	"path/filepath"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/oplog"
)

type correlationKey struct{}
type Correlation struct{ SessionID, RequestID, ChatID, TaskID string }

func WithCorrelation(ctx context.Context, identities Correlation) context.Context {
	return context.WithValue(ctx, correlationKey{}, identities)
}

func recoverLock(parent context.Context, root string) bool {
	ctx, cancel := context.WithTimeout(parent, 3*time.Second)
	defer cancel()
	socket := strings.TrimSpace(os.Getenv("HARNESS_HOST_GIT_SOCKET"))
	result := HostResult{Error: "host_bridge_unavailable"}
	if filepath.IsAbs(socket) {
		result = requestRecovery(ctx, socket, root)
	}
	recovered, reason, path, age := false, result.Error, "", int64(0)
	if result.ExitCode == 0 && result.Error == "" && result.Recovery != nil {
		recovered, reason = result.Recovery.Recovered, result.Recovery.Reason
		path, age = result.Recovery.Path, result.Recovery.AgeSeconds
	}
	if reason == "" {
		reason = "host_bridge_invalid_response"
	}
	event := "git.index_lock_recovery_blocked"
	if recovered {
		event = "git.index_lock_recovery_completed"
	}
	identities, _ := ctx.Value(correlationKey{}).(Correlation)
	oplog.Default().Emit(oplog.Record{
		Event: event, ProjectID: root, SessionID: identities.SessionID,
		RequestID: identities.RequestID, ChatID: identities.ChatID, TaskID: identities.TaskID,
		Data: map[string]any{"repository": root, "path": path, "age_seconds": age, "reason": reason},
	})
	return recovered
}

func requestRecovery(ctx context.Context, socket, root string) HostResult {
	conn, err := (&net.Dialer{}).DialContext(ctx, "unix", socket)
	if err != nil {
		return HostResult{Error: "host_bridge_unavailable"}
	}
	defer conn.Close()
	deadline, _ := ctx.Deadline()
	_ = conn.SetDeadline(deadline)
	stop := context.AfterFunc(ctx, func() { _ = conn.Close() })
	defer stop()
	if err := json.NewEncoder(conn).Encode(HostRequest{Operation: "recover_index_lock", Root: root}); err != nil {
		return HostResult{Error: "host_bridge_unavailable"}
	}
	var result HostResult
	decoder := json.NewDecoder(io.LimitReader(conn, 8192))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&result); err != nil {
		return HostResult{Error: "host_bridge_invalid_response"}
	}
	return result
}
