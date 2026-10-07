//go:build linux

package recovery

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"golang.org/x/sys/unix"
)

func TestKernelProofReplacesPrivateDescriptorInventory(t *testing.T) {
	for _, held := range []bool{false, true} {
		t.Run(map[bool]string{false: "abandoned", true: "open"}[held], func(t *testing.T) {
			root, lock := repository(t)
			proc := t.TempDir()
			process(t, proc, "1", "init")
			private := process(t, proc, "2", "browser")
			// A directory is unobservable even when the tests run as root.
			if err := os.RemoveAll(filepath.Join(private, "fd")); err != nil {
				t.Fatal(err)
			}
			put(t, filepath.Join(private, "fd"), "")
			if held {
				file, err := os.Open(lock)
				if err != nil {
					t.Fatal(err)
				}
				defer file.Close()
			}
			result := clear(context.Background(), root, func(info os.FileInfo) error {
				return processProof(context.Background(), proc, info)
			})
			if result.Recovered == held {
				t.Fatalf("held=%v: %+v", held, result)
			}
			if held && result.Reason != "lock_open_or_lease_unavailable" {
				t.Fatalf("open lock must be refused by kernel proof: %+v", result)
			}
			_, err := os.Lstat(lock)
			if held && err != nil || !held && !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("held=%v: lock state: %v", held, err)
			}
		})
	}
}

func TestLeaseBreakPreservesLock(t *testing.T) {
	_, lock := repository(t)
	info, _ := os.Lstat(lock)
	lease, err := exclusiveLock(lock, info)
	if err != nil {
		t.Fatal(err)
	}
	defer lease.Close()
	fd, err := unix.Open(lock, unix.O_RDONLY|unix.O_NONBLOCK, 0)
	if fd >= 0 {
		unix.Close(fd)
	}
	if !errors.Is(err, unix.EWOULDBLOCK) || leaseHeld(lease) {
		t.Fatalf("concurrent open must break exclusivity: %v", err)
	}
	if err := quarantine(lock, info, func() bool { return leaseHeld(lease) }); err == nil {
		t.Fatal("cleanup accepted a broken lease")
	}
	if _, err := os.Lstat(lock); err != nil {
		t.Fatalf("contended lock lost: %v", err)
	}
}
