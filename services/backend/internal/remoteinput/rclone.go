package remoteinput

import (
	"context"
	"errors"
	"fmt"
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
	link := strings.TrimSpace(string(output))
	parsed, err := parsePublishedURL(link)
	if err != nil {
		_ = p.Delete(ctx, objectName)
		return Publication{}, errors.New("rclone returned an invalid public HTTPS link")
	}
	return Publication{Provider: p.Name(), URL: parsed.String()}, nil
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
