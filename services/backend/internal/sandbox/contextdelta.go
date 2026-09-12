package sandbox

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"strconv"
	"strings"
)

// DeltaFile is one path that differs between two commits, with the line counts
// Git measured for it. Renames are reported as the destination path so the
// planner sees where the content lives now.
type DeltaFile struct {
	Path      string
	Status    string
	Additions int
	Deletions int
}

// DiffBetween reports which paths differ between two commits and by how much,
// without touching any working tree.
//
// This is the measurement behind a continuation request's divergence report.
// Sending a planner a whole fresh baseline every round tells it that something
// changed but not what, so it re-reads the project instead of rebasing the edit
// it already designed; naming the exact paths and line counts is what lets it
// keep reasoning against the snapshot it already holds.
//
// It is best effort in the same sense as the request-base capture it compares:
// an unreadable revision returns an error the caller degrades on, never a
// failure of the user's request.
func DiffBetween(ctx context.Context, repoPath, fromSHA, toSHA string) ([]DeltaFile, error) {
	fromSHA = strings.TrimSpace(fromSHA)
	toSHA = strings.TrimSpace(toSHA)
	if fromSHA == "" || toSHA == "" {
		return nil, errors.New("both revisions are required")
	}
	if fromSHA == toSHA {
		return nil, nil
	}
	// --numstat carries additions/deletions and the rename destination in one
	// pass; -M detects renames so a moved file is one entry rather than a
	// delete plus an unrelated-looking create.
	output, err := runGit(ctx, repoPath, "diff", "--numstat", "-M", "--no-color", fromSHA, toSHA)
	if err != nil {
		return nil, errors.New("diff " + fromSHA + ".." + toSHA + ": " + output)
	}
	statuses, err := diffStatuses(ctx, repoPath, fromSHA, toSHA)
	if err != nil {
		return nil, err
	}
	files := make([]DeltaFile, 0)
	for _, line := range strings.Split(strings.TrimSpace(output), "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		fields := strings.Split(line, "\t")
		if len(fields) < 3 {
			continue
		}
		path := strings.TrimSpace(fields[len(fields)-1])
		if path == "" {
			continue
		}
		status := statuses[path]
		if status == "" {
			status = "modified"
		}
		file := DeltaFile{Path: path, Status: status}
		// Git writes "-" for both counts on a binary file. Reporting 0 there is
		// correct and deliberate: the planner must see the path changed without
		// being told a binary change was a no-op.
		file.Additions, _ = strconv.Atoi(strings.TrimSpace(fields[0]))
		file.Deletions, _ = strconv.Atoi(strings.TrimSpace(fields[1]))
		files = append(files, file)
	}
	return files, nil
}

// diffStatuses maps each changed path to added/modified/deleted/renamed.
func diffStatuses(ctx context.Context, repoPath, fromSHA, toSHA string) (map[string]string, error) {
	output, err := runGit(ctx, repoPath, "diff", "--name-status", "-M", "--no-color", fromSHA, toSHA)
	if err != nil {
		return nil, errors.New("name-status " + fromSHA + ".." + toSHA + ": " + output)
	}
	statuses := make(map[string]string)
	for _, line := range strings.Split(strings.TrimSpace(output), "\n") {
		fields := strings.Split(strings.TrimSpace(line), "\t")
		if len(fields) < 2 || fields[0] == "" {
			continue
		}
		path := strings.TrimSpace(fields[len(fields)-1])
		switch fields[0][0] {
		case 'A':
			statuses[path] = "added"
		case 'D':
			statuses[path] = "deleted"
		case 'R':
			statuses[path] = "renamed"
		case 'C':
			statuses[path] = "copied"
		default:
			statuses[path] = "modified"
		}
	}
	return statuses, nil
}

// DiffPatchBetween returns the real unified diff between two commits, bounded
// by limit bytes. An oversized diff returns ok=false rather than a truncated
// patch: half a hunk is not a patch, and a planner handed one would author a
// correction against content it cannot see the end of.
//
// excludePaths are dropped from the comparison. Wharnex-managed project state
// is transported by its own protocol and cannot be planner-patched, so letting
// it into a divergence report only invites edits the validator then rejects.
func DiffPatchBetween(ctx context.Context, repoPath, fromSHA, toSHA string, limit int, excludePaths []string) (patch string, ok bool, err error) {
	fromSHA = strings.TrimSpace(fromSHA)
	toSHA = strings.TrimSpace(toSHA)
	if fromSHA == "" || toSHA == "" {
		return "", false, errors.New("both revisions are required")
	}
	if fromSHA == toSHA {
		return "", true, nil
	}
	args := []string{"-C", repoPath, "diff", "--no-color", "-M", fromSHA, toSHA, "--"}
	for _, path := range excludePaths {
		if path = strings.TrimSpace(path); path != "" {
			args = append(args, ":(exclude)"+path)
		}
	}
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	output, runErr := cmd.Output()
	if runErr != nil {
		var exitErr *exec.ExitError
		if errors.As(runErr, &exitErr) {
			return "", false, errors.New("diff patch " + fromSHA + ".." + toSHA + ": " + strings.TrimSpace(string(exitErr.Stderr)))
		}
		return "", false, runErr
	}
	if limit > 0 && len(output) > limit {
		return "", false, nil
	}
	return string(output), true, nil
}
