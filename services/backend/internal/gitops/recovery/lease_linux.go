//go:build linux

package recovery

import (
	"errors"
	"os"
	"syscall"

	"golang.org/x/sys/unix"
)

// exclusiveLock proves absence of any other open file description in the
// kernel, including processes whose descriptor inventory is private. It never
// creates/truncates the lock or waits for a competing lease to become available.
func exclusiveLock(path string, expected os.FileInfo) (*os.File, error) {
	fd, err := unix.Open(path, unix.O_RDWR|unix.O_NOFOLLOW|unix.O_CLOEXEC|unix.O_NONBLOCK, 0)
	if err != nil {
		return nil, errors.New("lock_missing_or_unobservable")
	}
	file := os.NewFile(uintptr(fd), path)
	info, err := file.Stat()
	if err != nil || !sameLock(expected, info) || expected.Sys().(*syscall.Stat_t).Ctim != info.Sys().(*syscall.Stat_t).Ctim {
		file.Close()
		return nil, errors.New("lock_changed")
	}
	// SIGURG is nonterminating; no process-global signal handler is installed.
	// After acquisition disable notifications and observe breaks via GETLEASE.
	if _, err = unix.FcntlInt(file.Fd(), unix.F_SETSIG, int(unix.SIGURG)); err == nil {
		_, err = unix.FcntlInt(file.Fd(), unix.F_SETLEASE, unix.F_WRLCK)
	}
	if err == nil {
		_, err = unix.FcntlInt(file.Fd(), unix.F_SETOWN, 0)
	}
	if err != nil || !leaseHeld(file) {
		file.Close()
		return nil, errors.New("lock_open_or_lease_unavailable")
	}
	return file, nil
}

func leaseHeld(file *os.File) bool {
	kind, err := unix.FcntlInt(file.Fd(), unix.F_GETLEASE, 0)
	return err == nil && kind == unix.F_WRLCK
}
