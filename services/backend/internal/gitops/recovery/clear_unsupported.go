//go:build !linux

package recovery

import "context"

func ClearOnHost(context.Context, string) Result {
	return Result{Reason: "host_process_view_unavailable"}
}
