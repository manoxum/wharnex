package remoteinput

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path"
	"strings"
	"time"
)

type HTTPConfig struct {
	UploadBaseURL string
	PublicBaseURL string
	Authorization string
}

type HTTPProvider struct {
	uploadBase *url.URL
	publicBase *url.URL
	auth       string
	client     *http.Client
}

func NewHTTPProvider(cfg HTTPConfig) (*HTTPProvider, error) {
	upload, err := parseEndpoint(cfg.UploadBaseURL, false)
	if err != nil {
		return nil, fmt.Errorf("remote upload URL: %w", err)
	}
	public, err := parseEndpoint(cfg.PublicBaseURL, true)
	if err != nil {
		return nil, fmt.Errorf("remote public URL: %w", err)
	}
	client := &http.Client{Timeout: 10 * time.Minute, CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
		return http.ErrUseLastResponse
	}}
	return &HTTPProvider{uploadBase: upload, publicBase: public, auth: strings.TrimSpace(cfg.Authorization), client: client}, nil
}

func (p *HTTPProvider) Name() string { return "http" }

func (p *HTTPProvider) Put(ctx context.Context, objectName, filePath string) (Publication, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return Publication{}, err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return Publication{}, err
	}
	target := objectURL(p.uploadBase, objectName)
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, target.String(), file)
	if err != nil {
		return Publication{}, err
	}
	req.ContentLength = info.Size()
	req.Header.Set("Content-Type", "application/zip")
	if p.auth != "" {
		req.Header.Set("Authorization", p.auth)
	}
	response, err := p.client.Do(req)
	if err != nil {
		return Publication{}, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return Publication{}, fmt.Errorf("upload returned HTTP %d", response.StatusCode)
	}
	return Publication{Provider: p.Name(), URL: objectURL(p.publicBase, objectName).String()}, nil
}

func (p *HTTPProvider) Delete(ctx context.Context, objectName string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, objectURL(p.uploadBase, objectName).String(), nil)
	if err != nil {
		return err
	}
	if p.auth != "" {
		req.Header.Set("Authorization", p.auth)
	}
	response, err := p.client.Do(req)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNotFound || response.StatusCode == http.StatusGone {
		return nil
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("delete returned HTTP %d", response.StatusCode)
	}
	return nil
}

func parseEndpoint(raw string, public bool) (*url.URL, error) {
	value, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || value.Host == "" || (value.Scheme != "https" && value.Scheme != "http") {
		return nil, errors.New("must be an absolute HTTP(S) URL")
	}
	if value.User != nil || value.RawQuery != "" || value.Fragment != "" {
		return nil, errors.New("userinfo, query, and fragment are not allowed")
	}
	if public && value.Scheme != "https" {
		return nil, errors.New("must use HTTPS")
	}
	return value, nil
}

func objectURL(base *url.URL, objectName string) *url.URL {
	copy := *base
	copy.Path = path.Join(copy.Path, objectName)
	return &copy
}
