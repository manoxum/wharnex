package gitops

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"strings"
)

// IndexGitlinks streams the authoritative index, retaining only NUL-delimited
// gitlinks. Large ordinary indexes never become a combined-output buffer.
func IndexGitlinks(ctx context.Context, root string) (string, error) {
	if _, err := exec.LookPath("git"); err != nil {
		return "", ErrUnavailable
	}
	return retry(ctx, root, func() (string, string, error) {
		cmd := exec.CommandContext(ctx, "git", "-C", root, "ls-files", "--stage", "-z")
		cmd.Env = environment()
		var diagnostic boundedIndexDiagnostic
		cmd.Stderr = &diagnostic
		pipe, err := cmd.StdoutPipe()
		if err != nil {
			return "", "", err
		}
		if err = cmd.Start(); err != nil {
			return "", "", err
		}
		output, readErr := selectGitlinks(pipe)
		if readErr != nil {
			_ = cmd.Process.Kill()
		}
		err = errors.Join(readErr, cmd.Wait())
		if err != nil {
			err = fmt.Errorf("read Git index: %w: %s", err, diagnostic.String())
		}
		return output, diagnostic.String(), err
	}, recoverLock)
}

func selectGitlinks(input io.Reader) (string, error) {
	scanner := bufio.NewScanner(input)
	scanner.Buffer(make([]byte, 64<<10), 1<<20)
	scanner.Split(func(data []byte, eof bool) (int, []byte, error) {
		if index := bytes.IndexByte(data, 0); index >= 0 {
			return index + 1, data[:index], nil
		}
		if eof && len(data) != 0 {
			return 0, nil, io.ErrUnexpectedEOF
		}
		return 0, nil, nil
	})
	var links strings.Builder
	for scanner.Scan() {
		entry := scanner.Bytes()
		if bytes.HasPrefix(entry, []byte("160000 ")) {
			links.Write(entry)
			links.WriteByte(0)
		}
	}
	return links.String(), scanner.Err()
}

// Diagnostics are drained concurrently by os/exec even after the bound, so
// a noisy failed Git process cannot block the index reader or grow its heap.
type boundedIndexDiagnostic struct{ strings.Builder }

func (b *boundedIndexDiagnostic) Write(data []byte) (int, error) {
	n := len(data)
	remaining := (64 << 10) - b.Len()
	if remaining > 0 {
		if len(data) > remaining {
			data = data[:remaining]
		}
		_, _ = b.Builder.Write(data)
	}
	return n, nil
}
