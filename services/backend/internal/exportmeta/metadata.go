package exportmeta

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

const (
	Schema            = "wharness.exports/v1"
	maxGitOutputBytes = 256 * 1024
)

type Metadata struct {
	Kind        string
	ProjectName string
	ProjectRoot string
	GeneratedAt time.Time
	Git         GitMetadata
	Runtime     *RuntimeMetadata
}

type GitMetadata struct {
	Available      bool
	Repository     bool
	RepositoryRoot string
	Branch         string
	Head           string
	Status         string
	Worktrees      string
	Error          string
}

type RuntimeMetadata struct {
	Status            string
	Logs              string
	SelfEvolutionLogs string
	Error             string
}

func Capture(root, kind string, generatedAt time.Time) Metadata {
	abs, err := filepath.Abs(root)
	if err != nil {
		abs = root
	}
	meta := Metadata{
		Kind:        strings.TrimSpace(kind),
		ProjectName: filepath.Base(filepath.Clean(abs)),
		ProjectRoot: abs,
		GeneratedAt: generatedAt,
	}
	meta.Git = captureGit(abs)
	return meta
}

func (m Metadata) Markdown() []byte {
	var out bytes.Buffer
	fmt.Fprintln(&out, "# Wharnex Export Metadata")
	fmt.Fprintln(&out)
	fmt.Fprintf(&out, "- Schema: `%s`\n", Schema)
	fmt.Fprintf(&out, "- Kind: `%s`\n", fallback(m.Kind, "context"))
	fmt.Fprintf(&out, "- Project: `%s`\n", markdownCode(m.ProjectName))
	fmt.Fprintf(&out, "- Project root: `%s`\n", markdownCode(m.ProjectRoot))
	if !m.GeneratedAt.IsZero() {
		fmt.Fprintf(&out, "- Generated at (UTC): `%s`\n", m.GeneratedAt.UTC().Format(time.RFC3339))
	}
	fmt.Fprintln(&out, "- VCS internals: `.git` is excluded from the archive; Git state is captured below for analysis.")
	fmt.Fprintln(&out, "- Git remotes: intentionally omitted to avoid exporting credential-bearing URLs.")
	fmt.Fprintln(&out)
	fmt.Fprintln(&out, "## Git summary")
	fmt.Fprintln(&out)
	fmt.Fprintf(&out, "- Git available: `%t`\n", m.Git.Available)
	fmt.Fprintf(&out, "- Git repository: `%t`\n", m.Git.Repository)
	if m.Git.RepositoryRoot != "" {
		fmt.Fprintf(&out, "- Repository root: `%s`\n", markdownCode(m.Git.RepositoryRoot))
	}
	if m.Git.Branch != "" {
		fmt.Fprintf(&out, "- Branch: `%s`\n", markdownCode(m.Git.Branch))
	}
	if m.Git.Head != "" {
		fmt.Fprintf(&out, "- HEAD: `%s`\n", markdownCode(m.Git.Head))
	}
	if m.Git.Error != "" {
		fmt.Fprintf(&out, "- Git metadata warning: `%s`\n", markdownCode(m.Git.Error))
	}
	fmt.Fprintln(&out)
	fmt.Fprintln(&out, "## Git status")
	fmt.Fprintln(&out)
	writeFence(&out, m.Git.Status, "Not a Git repository or status unavailable.")
	fmt.Fprintln(&out)
	fmt.Fprintln(&out, "## Git worktrees")
	fmt.Fprintln(&out)
	writeFence(&out, m.Git.Worktrees, "Not a Git repository or worktree information unavailable.")
	if m.Runtime != nil {
		fmt.Fprintln(&out)
		fmt.Fprintln(&out, "## Wharnex status")
		fmt.Fprintln(&out)
		writeFence(&out, m.Runtime.Status, "Wharnex status unavailable.")
		fmt.Fprintln(&out)
		fmt.Fprintln(&out, "## Wharnex recent logs")
		fmt.Fprintln(&out)
		fmt.Fprintf(&out, "Last up to %d lines / %d KiB from `.harness/logs/desktop.log`; secret-like values are redacted.\n\n", maxRuntimeLogLines, maxRuntimeOutputBytes/1024)
		writeFence(&out, m.Runtime.Logs, "No Wharnex desktop log available.")
		if m.Runtime.SelfEvolutionLogs != "" {
			fmt.Fprintln(&out)
			fmt.Fprintln(&out, "## Wharnex self-evolution logs")
			fmt.Fprintln(&out)
			fmt.Fprintf(&out, "Last up to %d lines / %d KiB from `.harness/logs/self-evolution.log`; secret-like values are redacted.\n\n", maxRuntimeLogLines, maxRuntimeOutputBytes/1024)
			writeFence(&out, m.Runtime.SelfEvolutionLogs, "No Wharnex self-evolution log available.")
		}
		if m.Runtime.Error != "" {
			fmt.Fprintln(&out)
			fmt.Fprintf(&out, "- Runtime metadata warning: `%s`\n", markdownCode(m.Runtime.Error))
		}
	}
	return out.Bytes()
}

func (m Metadata) SemanticSHA256() string {
	stable := m
	stable.GeneratedAt = time.Time{}
	stable.Runtime = nil
	sum := sha256.Sum256(stable.Markdown())
	return hex.EncodeToString(sum[:])
}

func captureGit(root string) GitMetadata {
	if _, err := exec.LookPath("git"); err != nil {
		return GitMetadata{Error: "git executable not found"}
	}
	meta := GitMetadata{Available: true}
	inside, err := runGit(root, "rev-parse", "--is-inside-work-tree")
	if err != nil || strings.TrimSpace(inside) != "true" {
		return meta
	}
	meta.Repository = true
	meta.RepositoryRoot, _ = runGit(root, "rev-parse", "--show-toplevel")
	meta.RepositoryRoot = strings.TrimSpace(meta.RepositoryRoot)
	meta.Branch, _ = runGit(root, "symbolic-ref", "--quiet", "--short", "HEAD")
	meta.Branch = strings.TrimSpace(meta.Branch)
	if meta.Branch == "" {
		meta.Branch = "(detached HEAD)"
	}
	meta.Head, _ = runGit(root, "rev-parse", "--verify", "HEAD")
	meta.Head = strings.TrimSpace(meta.Head)
	if meta.Head == "" {
		meta.Head = "(unborn)"
	}
	status, statusErr := runGit(root, "status", "--short", "--branch", "--untracked-files=all")
	meta.Status = strings.TrimSpace(status)
	worktrees, worktreeErr := runGit(root, "worktree", "list", "--porcelain")
	meta.Worktrees = strings.TrimSpace(worktrees)
	var warnings []string
	if statusErr != nil {
		warnings = append(warnings, "git status: "+statusErr.Error())
	}
	if worktreeErr != nil {
		warnings = append(warnings, "git worktree list: "+worktreeErr.Error())
	}
	meta.Error = strings.Join(warnings, "; ")
	return meta
}

func runGit(root string, args ...string) (string, error) {
	argv := append([]string{"-c", "core.quotepath=false", "-C", root}, args...)
	return runCommand(root, 5*time.Second, "git", argv...)
}

func runCommand(root string, timeout time.Duration, name string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Dir = root
	cmd.Env = append(cmd.Environ(), "GIT_TERMINAL_PROMPT=0", "WHARNESS_ROOT="+root)
	var out limitedBuffer
	cmd.Stdout = &out
	cmd.Stderr = &out
	err := cmd.Run()
	value := strings.TrimSpace(out.String())
	if out.truncated {
		value += "\n...[truncated by Wharnex]"
	}
	if ctx.Err() != nil {
		return value, fmt.Errorf("timed out")
	}
	if err != nil {
		if value != "" {
			return value, fmt.Errorf("%s", oneLine(value))
		}
		return value, err
	}
	return value, nil
}

type limitedBuffer struct {
	bytes     []byte
	truncated bool
}

func (b *limitedBuffer) Write(p []byte) (int, error) {
	original := len(p)
	remaining := maxGitOutputBytes - len(b.bytes)
	if remaining > 0 {
		if len(p) > remaining {
			p = p[:remaining]
			b.truncated = true
		}
		b.bytes = append(b.bytes, p...)
	} else if original > 0 {
		b.truncated = true
	}
	return original, nil
}

func (b *limitedBuffer) String() string { return string(b.bytes) }

func writeFence(out *bytes.Buffer, value, empty string) {
	value = strings.TrimSpace(value)
	if value == "" {
		value = empty
	}
	fmt.Fprintln(out, "```text")
	fmt.Fprintln(out, value)
	fmt.Fprintln(out, "```")
}

func markdownCode(value string) string {
	return strings.ReplaceAll(value, "`", "'")
}

func fallback(value, defaultValue string) string {
	if strings.TrimSpace(value) == "" {
		return defaultValue
	}
	return strings.TrimSpace(value)
}

func oneLine(value string) string {
	return strings.Join(strings.Fields(value), " ")
}
