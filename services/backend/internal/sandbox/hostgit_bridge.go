package sandbox

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

const maxHostGitOutputBytes = 1024 * 1024

type HostGitRequest struct {
	Operation   string `json:"operation"`
	Root        string `json:"root"`
	Remote      string `json:"remote"`
	Branch      string `json:"branch,omitempty"`
	CommitSHA   string `json:"commit_sha,omitempty"`
	Tag         string `json:"tag,omitempty"`
	Title       string `json:"title,omitempty"`
	Body        string `json:"body,omitempty"`
	SetUpstream bool   `json:"set_upstream,omitempty"`
}

type HostGitResult struct {
	Output   string `json:"output,omitempty"`
	ExitCode int    `json:"exit_code"`
	Error    string `json:"error,omitempty"`
}

func RunHostGit(ctx context.Context, socketPath string, request HostGitRequest) (HostGitResult, error) {
	socketPath = strings.TrimSpace(socketPath)
	if socketPath == "" || !filepath.IsAbs(socketPath) {
		return HostGitResult{}, errors.New("host Git bridge socket must be an absolute path")
	}
	conn, err := (&net.Dialer{}).DialContext(ctx, "unix", socketPath)
	if err != nil {
		return HostGitResult{}, fmt.Errorf("connect host Git bridge: %w", err)
	}
	defer conn.Close()
	if deadline, ok := ctx.Deadline(); ok {
		_ = conn.SetDeadline(deadline)
	}
	if err := json.NewEncoder(conn).Encode(request); err != nil {
		return HostGitResult{}, fmt.Errorf("send host Git request: %w", err)
	}
	var result HostGitResult
	if err := json.NewDecoder(conn).Decode(&result); err != nil {
		return HostGitResult{}, fmt.Errorf("read host Git response: %w", err)
	}
	if result.Error != "" {
		return result, errors.New(result.Error)
	}
	return result, nil
}

func ServeHostGitBridge(ctx context.Context, socketPath string) error {
	socketPath = strings.TrimSpace(socketPath)
	if socketPath == "" || !filepath.IsAbs(socketPath) {
		return errors.New("host Git bridge socket must be an absolute path")
	}
	if err := os.MkdirAll(filepath.Dir(socketPath), 0o700); err != nil {
		return fmt.Errorf("prepare host Git bridge directory: %w", err)
	}
	if err := removeStaleUnixSocket(socketPath); err != nil {
		return err
	}
	listener, err := net.Listen("unix", socketPath)
	if err != nil {
		return fmt.Errorf("listen host Git bridge: %w", err)
	}
	defer func() { _ = listener.Close(); _ = os.Remove(socketPath) }()
	if err := os.Chmod(socketPath, 0o600); err != nil {
		return fmt.Errorf("secure host Git bridge socket: %w", err)
	}
	go func() { <-ctx.Done(); _ = listener.Close() }()
	for {
		conn, err := listener.Accept()
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			return fmt.Errorf("accept host Git bridge connection: %w", err)
		}
		go handleHostGitConnection(ctx, conn)
	}
}

func removeStaleUnixSocket(socketPath string) error {
	info, err := os.Lstat(socketPath)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if info.Mode()&os.ModeSocket == 0 {
		return fmt.Errorf("refusing to replace non-socket host Git bridge path %s", socketPath)
	}
	probe, dialErr := net.DialTimeout("unix", socketPath, 250*time.Millisecond)
	if dialErr == nil {
		_ = probe.Close()
		return fmt.Errorf("host Git bridge is already listening on %s", socketPath)
	}
	if err := os.Remove(socketPath); err != nil {
		return fmt.Errorf("remove stale host Git bridge socket: %w", err)
	}
	return nil
}

func handleHostGitConnection(parent context.Context, conn net.Conn) {
	defer conn.Close()
	var request HostGitRequest
	encoder := json.NewEncoder(conn)
	if err := json.NewDecoder(conn).Decode(&request); err != nil {
		_ = encoder.Encode(HostGitResult{ExitCode: -1, Error: "invalid host Git request"})
		return
	}
	ctx, cancel := context.WithTimeout(parent, 2*time.Minute)
	defer cancel()
	if request.Operation == "github_release" {
		releaseURL, err := CreateGitHubRelease(ctx, request)
		if err != nil {
			_ = encoder.Encode(HostGitResult{ExitCode: -1, Error: err.Error()})
			return
		}
		_ = encoder.Encode(HostGitResult{ExitCode: 0, Output: releaseURL})
		return
	}
	args, err := hostGitArgs(request)
	if err != nil {
		_ = encoder.Encode(HostGitResult{ExitCode: -1, Error: err.Error()})
		return
	}
	cmd := exec.CommandContext(ctx, "git", append([]string{"-C", request.Root}, args...)...)
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	output, runErr := cmd.CombinedOutput()
	if len(output) > maxHostGitOutputBytes {
		output = output[:maxHostGitOutputBytes]
	}
	result := HostGitResult{Output: strings.TrimSpace(string(output)), ExitCode: 0}
	if runErr != nil {
		result.ExitCode = -1
		var exitErr *exec.ExitError
		if errors.As(runErr, &exitErr) {
			result.ExitCode = exitErr.ExitCode()
		} else {
			result.Error = runErr.Error()
		}
	}
	_ = encoder.Encode(result)
}

func hostGitArgs(request HostGitRequest) ([]string, error) {
	request.Root = strings.TrimSpace(request.Root)
	request.Remote = strings.TrimSpace(request.Remote)
	request.Branch = strings.TrimSpace(request.Branch)
	request.CommitSHA = strings.TrimSpace(request.CommitSHA)
	request.Tag = strings.TrimSpace(request.Tag)
	if request.Root == "" || !filepath.IsAbs(request.Root) {
		return nil, errors.New("host Git root must be absolute")
	}
	if request.Remote == "" || strings.HasPrefix(request.Remote, "-") {
		return nil, errors.New("a valid remote is required")
	}
	switch request.Operation {
	case "fetch":
		return []string{"fetch", "--quiet", "--no-tags", "--", request.Remote}, nil
	case "push":
		if err := validateHostGitBranch(request.Branch); err != nil {
			return nil, err
		}
		args := []string{"push"}
		if request.SetUpstream {
			args = append(args, "--set-upstream")
		}
		return append(args, "--", request.Remote, request.Branch+":refs/heads/"+request.Branch), nil
	case "push_commit":
		if err := validateHostGitBranch(request.Branch); err != nil {
			return nil, err
		}
		if len(request.CommitSHA) != 40 || !isHexSHA(request.CommitSHA) {
			return nil, errors.New("invalid commit sha")
		}
		return []string{"push", "--", request.Remote, request.CommitSHA + ":refs/heads/" + request.Branch}, nil
	case "push_tag":
		if err := validateHostGitTag(request.Tag); err != nil {
			return nil, err
		}
		return []string{"push", "--", request.Remote, "refs/tags/" + request.Tag + ":refs/tags/" + request.Tag}, nil
	case "delete_branch":
		if err := validateHostGitBranch(request.Branch); err != nil {
			return nil, err
		}
		return []string{"push", "--", request.Remote, ":refs/heads/" + request.Branch}, nil
	default:
		return nil, fmt.Errorf("unsupported host Git operation %q", request.Operation)
	}
}

func validateHostGitTag(tag string) error {
	if tag == "" || strings.HasPrefix(tag, "-") || strings.ContainsAny(tag, " \t\r\n") {
		return errors.New("a valid tag is required")
	}
	return nil
}

func validateHostGitBranch(branch string) error {
	if branch == "" || strings.HasPrefix(branch, "-") {
		return errors.New("a valid branch is required")
	}
	return nil
}

func isHexSHA(value string) bool {
	for _, r := range value {
		if !((r >= '0' && r <= '9') || (r >= 'a' && r <= 'f') || (r >= 'A' && r <= 'F')) {
			return false
		}
	}
	return true
}

// CreateGitHubRelease creates or reuses the release for a tag on github.com.
// Authentication is resolved only in the process executing this function: the
// token never crosses the bridge response or enters application logs.
func CreateGitHubRelease(ctx context.Context, request HostGitRequest) (string, error) {
	request.Root = strings.TrimSpace(request.Root)
	request.Remote = strings.TrimSpace(request.Remote)
	request.Tag = strings.TrimSpace(request.Tag)
	request.Title = strings.TrimSpace(request.Title)
	if request.Root == "" || !filepath.IsAbs(request.Root) {
		return "", errors.New("host Git root must be absolute")
	}
	if request.Remote == "" || strings.HasPrefix(request.Remote, "-") {
		return "", errors.New("a valid remote is required")
	}
	if err := validateHostGitTag(request.Tag); err != nil {
		return "", err
	}
	if request.Title == "" {
		request.Title = request.Tag
	}
	remoteURLBytes, err := exec.CommandContext(ctx, "git", "-C", request.Root, "remote", "get-url", request.Remote).Output()
	if err != nil {
		return "", fmt.Errorf("resolve GitHub remote %s: remote URL is unavailable", request.Remote)
	}
	owner, repo, tokenHint, err := githubRepository(strings.TrimSpace(string(remoteURLBytes)))
	if err != nil {
		return "", err
	}
	token, err := githubToken(ctx, request.Root, owner, repo, tokenHint)
	if err != nil {
		return "", err
	}
	payload, err := json.Marshal(map[string]any{
		"tag_name":   request.Tag,
		"name":       request.Title,
		"body":       request.Body,
		"draft":      false,
		"prerelease": false,
	})
	if err != nil {
		return "", errors.New("encode GitHub release payload")
	}
	endpoint := "https://api.github.com/repos/" + url.PathEscape(owner) + "/" + url.PathEscape(repo) + "/releases"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(string(payload)))
	if err != nil {
		return "", errors.New("prepare GitHub release request")
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 45 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("create GitHub release: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusCreated {
		return decodeGitHubReleaseURL(resp.Body)
	}
	if resp.StatusCode == http.StatusUnprocessableEntity {
		if releaseURL, ok := findExistingGitHubRelease(ctx, client, owner, repo, request.Tag, token); ok {
			return releaseURL, nil
		}
	}
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 32<<10))
	return "", fmt.Errorf("GitHub release request failed with status %d", resp.StatusCode)
}

func githubRepository(raw string) (owner, repo, tokenHint string, err error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", "", "", errors.New("GitHub remote URL is empty")
	}
	if strings.HasPrefix(raw, "git@github.com:") {
		owner, repo, err = splitGitHubPath(strings.TrimPrefix(raw, "git@github.com:"))
		return owner, repo, "", err
	}
	parsed, parseErr := url.Parse(raw)
	if parseErr != nil || parsed.Hostname() != "github.com" {
		return "", "", "", errors.New("release publishing currently supports github.com remotes only")
	}
	owner, repo, err = splitGitHubPath(strings.TrimPrefix(parsed.Path, "/"))
	if parsed.User != nil {
		if password, ok := parsed.User.Password(); ok {
			tokenHint = password
		}
	}
	return owner, repo, tokenHint, err
}

func splitGitHubPath(path string) (string, string, error) {
	path = strings.TrimSuffix(strings.TrimSpace(path), ".git")
	parts := strings.Split(path, "/")
	if len(parts) != 2 || strings.TrimSpace(parts[0]) == "" || strings.TrimSpace(parts[1]) == "" {
		return "", "", errors.New("GitHub remote must identify owner/repository")
	}
	return parts[0], parts[1], nil
}

func githubToken(ctx context.Context, root, owner, repo, tokenHint string) (string, error) {
	for _, candidate := range []string{tokenHint, os.Getenv("GH_TOKEN"), os.Getenv("GITHUB_TOKEN")} {
		if token := strings.TrimSpace(candidate); token != "" {
			return token, nil
		}
	}
	cmd := exec.CommandContext(ctx, "git", "-C", root, "credential", "fill")
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	cmd.Stdin = strings.NewReader("protocol=https\nhost=github.com\npath=" + owner + "/" + repo + ".git\n\n")
	output, err := cmd.Output()
	if err == nil {
		for _, line := range strings.Split(string(output), "\n") {
			if key, value, found := strings.Cut(line, "="); found && key == "password" && strings.TrimSpace(value) != "" {
				return strings.TrimSpace(value), nil
			}
		}
	}
	return "", errors.New("GitHub authentication is unavailable on the host; configure GH_TOKEN, GITHUB_TOKEN, or a Git credential for github.com")
}

func decodeGitHubReleaseURL(reader io.Reader) (string, error) {
	var body struct {
		HTMLURL string `json:"html_url"`
	}
	if err := json.NewDecoder(io.LimitReader(reader, 1<<20)).Decode(&body); err != nil {
		return "", errors.New("decode GitHub release response")
	}
	if strings.TrimSpace(body.HTMLURL) == "" {
		return "", errors.New("GitHub release response did not include a URL")
	}
	return body.HTMLURL, nil
}

func findExistingGitHubRelease(ctx context.Context, client *http.Client, owner, repo, tag, token string) (string, bool) {
	endpoint := "https://api.github.com/repos/" + url.PathEscape(owner) + "/" + url.PathEscape(repo) + "/releases/tags/" + url.PathEscape(tag)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return "", false
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	resp, err := client.Do(req)
	if err != nil {
		return "", false
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", false
	}
	releaseURL, err := decodeGitHubReleaseURL(resp.Body)
	return releaseURL, err == nil
}
