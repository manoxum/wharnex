//go:build linux

package contextbundle

import (
	"os"
	"syscall"
	"time"
)

// Linux's portable FileInfo does not expose statx birth time. Ctime is the
// closest filesystem-provided creation/change signal available without adding
// an OS-specific dependency; callers present it as a best-effort creation date.
func bestEffortCreatedTime(info os.FileInfo) time.Time {
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return info.ModTime()
	}
	return time.Unix(stat.Ctim.Sec, stat.Ctim.Nsec)
}
