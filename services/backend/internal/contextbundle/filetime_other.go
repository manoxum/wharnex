//go:build !linux

package contextbundle

import (
	"os"
	"time"
)

func bestEffortCreatedTime(info os.FileInfo) time.Time {
	return info.ModTime()
}
