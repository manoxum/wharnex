//go:build linux

package recovery

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"golang.org/x/sys/unix"
)

var recoveryMu sync.Mutex

// ClearOnHost is called only by the restricted host bridge. Container and
// partial process views are refused rather than treated as evidence of death.
func ClearOnHost(ctx context.Context, root string) Result {
	for _, marker := range []string{"/.dockerenv", "/run/.containerenv"} {
		if _, err := os.Stat(marker); !errors.Is(err, os.ErrNotExist) {
			return Result{Reason: "host_process_view_unavailable"}
		}
	}
	mounts, err := os.ReadFile("/proc/mounts")
	if err != nil || len(mounts) > 1<<20 {
		return Result{Reason: "host_process_view_unavailable"}
	}
	for _, line := range strings.Split(string(mounts), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 4 || fields[1] != "/proc" {
			continue
		}
		for _, option := range strings.Split(fields[3], ",") {
			if strings.HasPrefix(option, "hidepid=") && option != "hidepid=0" {
				return Result{Reason: "process_visibility_incomplete"}
			}
		}
	}
	return clear(ctx, root, func(info os.FileInfo) error { return processProof(ctx, "/proc", info) })
}

func clear(ctx context.Context, root string, proof func(os.FileInfo) error) Result {
	recoveryMu.Lock()
	defer recoveryMu.Unlock()
	if ctx.Err() != nil {
		return Result{Reason: "cancelled"}
	}
	path, err := repositoryLock(ctx, root)
	if err != nil {
		return Result{Reason: err.Error()}
	}
	result := Result{Path: path}
	info, err := os.Lstat(path)
	if err != nil {
		result.Reason = "lock_missing_or_unobservable"
		return result
	}
	result.AgeSeconds = int64(time.Since(info.ModTime()).Seconds())
	if !eligible(info) {
		result.Reason = "lock_not_abandoned"
		return result
	}
	if err := proof(info); err != nil {
		result.Reason = err.Error()
		return result
	}
	lease, err := exclusiveLock(path, info)
	if err != nil {
		result.Reason = err.Error()
		return result
	}
	defer lease.Close()
	if ctx.Err() != nil {
		result.Reason = "cancelled"
		return result
	}
	current, err := os.Lstat(path)
	if err != nil || !sameLock(info, current) || info.Sys().(*syscall.Stat_t).Ctim != current.Sys().(*syscall.Stat_t).Ctim {
		result.Reason = "lock_changed"
		return result
	}
	if err := quarantine(path, info, func() bool { return leaseHeld(lease) }); err != nil {
		result.Reason = err.Error()
		return result
	}
	result.Recovered, result.Reason = true, "abandoned"
	return result
}

func eligible(info os.FileInfo) bool {
	metadata, ok := info.Sys().(*syscall.Stat_t)
	return ok && info.Mode().IsRegular() && info.Size() == 0 && metadata.Nlink == 1 &&
		metadata.Uid == uint32(os.Geteuid()) && time.Since(info.ModTime()) >= MinimumAge
}

func sameLock(before, after os.FileInfo) bool {
	return os.SameFile(before, after) && before.Mode() == after.Mode() &&
		before.Size() == after.Size() && before.ModTime().Equal(after.ModTime()) && eligible(after)
}

func quarantine(path string, expected os.FileInfo, exclusive ...func() bool) error {
	valid := func() bool { return len(exclusive) == 0 || exclusive[0]() }
	if !valid() {
		return errors.New("lock_lease_broken")
	}
	dir := filepath.Dir(path)
	fd, err := unix.Open(dir, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW, 0)
	if err != nil {
		return errors.New("git_directory_unobservable")
	}
	defer unix.Close(fd)
	temporary, err := os.CreateTemp(dir, "wharnex-index-lock-*")
	if err != nil {
		return errors.New("quarantine_unavailable")
	}
	name := temporary.Name()
	_ = temporary.Close()
	if err := os.Remove(name); err != nil {
		return errors.New("quarantine_unavailable")
	}
	base := filepath.Base(name)
	if err := unix.Renameat2(fd, "index.lock", fd, base, unix.RENAME_NOREPLACE); err != nil {
		return errors.New("lock_changed_or_quarantine_unavailable")
	}
	var current unix.Stat_t
	err = unix.Fstatat(fd, base, &current, unix.AT_SYMLINK_NOFOLLOW)
	metadata := expected.Sys().(*syscall.Stat_t)
	if err != nil || current.Dev != metadata.Dev || current.Ino != metadata.Ino ||
		current.Mode != metadata.Mode || current.Uid != metadata.Uid || current.Nlink != 1 ||
		current.Size != 0 || current.Mtim.Sec != metadata.Mtim.Sec || current.Mtim.Nsec != metadata.Mtim.Nsec {
		// Never overwrite a new Git lock. A raced replacement is retained even
		// when another writer has already filled the original pathname.
		_ = unix.Renameat2(fd, base, fd, "index.lock", unix.RENAME_NOREPLACE)
		return errors.New("lock_changed")
	}
	if !valid() {
		_ = unix.Renameat2(fd, base, fd, "index.lock", unix.RENAME_NOREPLACE)
		return errors.New("lock_lease_broken")
	}
	if err := unix.Unlinkat(fd, base, 0); err != nil {
		return errors.New("quarantine_retained")
	}
	return nil
}
