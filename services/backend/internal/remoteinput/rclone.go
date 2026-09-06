package remoteinput

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os/exec"
	"path"
	"strings"
)

type RcloneConfig struct {
	Remote        string
	Prefix        string
	PublicBaseURL string
	Provider      string
}

type RcloneProvider struct {
	remote     string
	prefix     string
	publicBase *url.URL
	provider   string
}

func NewRcloneProvider(cfg RcloneConfig) (*RcloneProvider, error) {
	if _, err := exec.LookPath("rclone"); err != nil {
		return nil, errors.New("rclone executable was not found; install rclone and run rclone config")
	}
	remote := strings.TrimSpace(cfg.Remote)
	if remote == "" || strings.ContainsAny(remote, "/\\\x00\r\n") || strings.HasPrefix(remote, "-") {
		return nil, errors.New("rclone remote name is invalid")
	}
	prefix := strings.Trim(strings.TrimSpace(cfg.Prefix), "/")
	if prefix == "" {
		prefix = "wharness-inputs"
	}
	if strings.Contains(prefix, "..") || strings.ContainsAny(prefix, "\\\x00\r\n") {
		return nil, errors.New("rclone prefix is invalid")
	}
	var public *url.URL
	var err error
	if strings.TrimSpace(cfg.PublicBaseURL) != "" {
		public, err = parseEndpoint(cfg.PublicBaseURL, true)
		if err != nil {
			return nil, fmt.Errorf("rclone public URL: %w", err)
		}
	}
	provider := strings.ToLower(strings.TrimSpace(cfg.Provider))
	if provider == "" {
		provider = "rclone"
	}
	return &RcloneProvider{remote: remote, prefix: prefix, publicBase: public, provider: provider}, nil
}

func (p *RcloneProvider) Name() string { return p.provider }

func (p *RcloneProvider) Put(ctx context.Context, objectName, filePath string) (Publication, error) {
	target := p.target(objectName)
	if output, err := exec.CommandContext(ctx, "rclone", "copyto", "--", filePath, target).CombinedOutput(); err != nil {
		return Publication{}, commandError("rclone copyto", output, err)
	}
	if p.publicBase != nil {
		return Publication{Provider: p.Name(), URL: objectURL(p.publicBase, objectName).String()}, nil
	}
	output, err := exec.CommandContext(ctx, "rclone", "link", target).Output()
	if err != nil {
		_ = p.Delete(ctx, objectName)
		return Publication{}, fmt.Errorf("create rclone public link: %w", err)
	}
	parsed, err := normalizeRclonePublishedURL(p.provider, string(output))
	if err != nil {
		_ = p.Delete(ctx, objectName)
		return Publication{}, errors.New("rclone returned a public link that is not a supported direct HTTPS download")
	}
	if p.provider == "drive" {
		if err := verifyDirectZIP(ctx, directDownloadClient(), parsed); err != nil {
			_ = p.Delete(ctx, objectName)
			return Publication{}, fmt.Errorf("verify Google Drive binary download: %w", err)
		}
	}
	return Publication{Provider: p.Name(), URL: parsed.String()}, nil
}

func normalizeRclonePublishedURL(provider, raw string) (*url.URL, error) {
	published, err := parsePublishedURL(raw)
	if err != nil {
		return nil, err
	}
	if strings.ToLower(strings.TrimSpace(provider)) != "drive" {
		return published, nil
	}
	if published.Hostname() != "drive.google.com" || published.Path != "/open" {
		return nil, errors.New("Google Drive did not return a supported file viewer URL")
	}
	id := published.Query().Get("id")
	if !validGoogleDriveFileID(id) {
		return nil, errors.New("Google Drive link has an invalid file id")
	}
	return &url.URL{
		Scheme:   "https",
		Host:     "drive.google.com",
		Path:     "/uc",
		RawQuery: "export=download&id=" + url.QueryEscape(id) + "&confirm=t",
	}, nil
}

func directDownloadClient() *http.Client {
	return &http.Client{CheckRedirect: func(request *http.Request, via []*http.Request) error {
		if len(via) >= 5 {
			return errors.New("too many download redirects")
		}
		if request.URL.Scheme != "https" || request.URL.Host == "" || request.URL.User != nil {
			return errors.New("download redirected outside HTTPS")
		}
		return nil
	}}
}

func verifyDirectZIP(ctx context.Context, client *http.Client, target *url.URL) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, target.String(), nil)
	if err != nil {
		return err
	}
	request.Header.Set("Range", "bytes=0-3")
	response, err := client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK && response.StatusCode != http.StatusPartialContent {
		return fmt.Errorf("download returned HTTP %d", response.StatusCode)
	}
	magic := make([]byte, 4)
	if _, err := io.ReadFull(response.Body, magic); err != nil {
		return errors.New("download did not return a ZIP header")
	}
	if magic[0] != 'P' || magic[1] != 'K' || magic[2] != 3 || magic[3] != 4 {
		return errors.New("download returned non-ZIP content")
	}
	return nil
}

func validGoogleDriveFileID(id string) bool {
	if id == "" || len(id) > 256 {
		return false
	}
	for _, character := range id {
		if (character >= 'a' && character <= 'z') || (character >= 'A' && character <= 'Z') ||
			(character >= '0' && character <= '9') || character == '-' || character == '_' {
			continue
		}
		return false
	}
	return true
}

func parsePublishedURL(raw string) (*url.URL, error) {
	value, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || value.Scheme != "https" || value.Host == "" || value.User != nil || value.Fragment != "" {
		return nil, errors.New("must be a public HTTPS URL without userinfo or fragment")
	}
	return value, nil
}

func (p *RcloneProvider) Delete(ctx context.Context, objectName string) error {
	output, err := exec.CommandContext(ctx, "rclone", "deletefile", p.target(objectName)).CombinedOutput()
	if err != nil {
		return commandError("rclone deletefile", output, err)
	}
	return nil
}

func (p *RcloneProvider) target(objectName string) string {
	return p.remote + ":" + path.Join(p.prefix, objectName)
}

func commandError(action string, output []byte, err error) error {
	// rclone output may contain URLs or provider details. Do not surface it.
	if len(output) > 0 {
		return fmt.Errorf("%s failed: %w", action, err)
	}
	return fmt.Errorf("%s failed: %w", action, err)
}
