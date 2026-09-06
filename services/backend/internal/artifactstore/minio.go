package artifactstore

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"strings"
	"time"
)

type Config struct {
	Endpoint  string
	AccessKey string
	SecretKey string
	Bucket    string
	Region    string
}

type MinIO struct {
	endpoint *url.URL
	access   string
	secret   string
	bucket   string
	region   string
	client   *http.Client
}

func NewMinIO(cfg Config) (*MinIO, error) {
	endpoint, err := url.Parse(strings.TrimSpace(cfg.Endpoint))
	if err != nil || endpoint.Scheme == "" || endpoint.Host == "" {
		return nil, errors.New("invalid MinIO endpoint")
	}
	if endpoint.Scheme != "http" && endpoint.Scheme != "https" {
		return nil, errors.New("MinIO endpoint must use http or https")
	}
	if strings.TrimSpace(cfg.AccessKey) == "" || strings.TrimSpace(cfg.SecretKey) == "" || strings.TrimSpace(cfg.Bucket) == "" {
		return nil, errors.New("MinIO credentials and bucket are required")
	}
	region := strings.TrimSpace(cfg.Region)
	if region == "" {
		region = "us-east-1"
	}
	return &MinIO{endpoint: endpoint, access: cfg.AccessKey, secret: cfg.SecretKey, bucket: cfg.Bucket, region: region, client: &http.Client{Timeout: 2 * time.Minute}}, nil
}

func (m *MinIO) EnsureBucket(ctx context.Context) error {
	response, err := m.do(ctx, http.MethodPut, m.bucket, nil, "")
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusOK || response.StatusCode == http.StatusNoContent || response.StatusCode == http.StatusConflict {
		return nil
	}
	return responseError(response)
}

func (m *MinIO) Put(ctx context.Context, key, contentType string, raw []byte) error {
	response, err := m.do(ctx, http.MethodPut, objectPath(m.bucket, key), raw, contentType)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return responseError(response)
	}
	return nil
}

func (m *MinIO) Get(ctx context.Context, key string) ([]byte, string, error) {
	response, err := m.do(ctx, http.MethodGet, objectPath(m.bucket, key), nil, "")
	if err != nil {
		return nil, "", err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, "", responseError(response)
	}
	raw, err := io.ReadAll(response.Body)
	return raw, response.Header.Get("Content-Type"), err
}

func (m *MinIO) Delete(ctx context.Context, key string) error {
	response, err := m.do(ctx, http.MethodDelete, objectPath(m.bucket, key), nil, "")
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNoContent || response.StatusCode == http.StatusOK || response.StatusCode == http.StatusNotFound {
		return nil
	}
	return responseError(response)
}

func (m *MinIO) do(ctx context.Context, method, object string, raw []byte, contentType string) (*http.Response, error) {
	target := *m.endpoint
	target.Path = "/" + strings.TrimPrefix(object, "/")
	body := bytes.NewReader(raw)
	req, err := http.NewRequestWithContext(ctx, method, target.String(), body)
	if err != nil {
		return nil, err
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	payloadHash := sha256.Sum256(raw)
	payloadHex := hex.EncodeToString(payloadHash[:])
	now := time.Now().UTC()
	amzDate := now.Format("20060102T150405Z")
	date := now.Format("20060102")
	req.Header.Set("X-Amz-Date", amzDate)
	req.Header.Set("X-Amz-Content-Sha256", payloadHex)
	canonicalURI := req.URL.EscapedPath()
	canonicalHeaders := "host:" + req.URL.Host + "\n" + "x-amz-content-sha256:" + payloadHex + "\n" + "x-amz-date:" + amzDate + "\n"
	signedHeaders := "host;x-amz-content-sha256;x-amz-date"
	canonicalRequest := strings.Join([]string{method, canonicalURI, "", canonicalHeaders, signedHeaders, payloadHex}, "\n")
	canonicalHash := sha256.Sum256([]byte(canonicalRequest))
	scope := date + "/" + m.region + "/s3/aws4_request"
	stringToSign := "AWS4-HMAC-SHA256\n" + amzDate + "\n" + scope + "\n" + hex.EncodeToString(canonicalHash[:])
	signingKey := hmacSHA256(hmacSHA256(hmacSHA256(hmacSHA256([]byte("AWS4"+m.secret), date), m.region), "s3"), "aws4_request")
	signature := hex.EncodeToString(hmacSHA256(signingKey, stringToSign))
	req.Header.Set("Authorization", "AWS4-HMAC-SHA256 Credential="+m.access+"/"+scope+", SignedHeaders="+signedHeaders+", Signature="+signature)
	return m.client.Do(req)
}

func hmacSHA256(key []byte, value string) []byte {
	h := hmac.New(sha256.New, key)
	_, _ = h.Write([]byte(value))
	return h.Sum(nil)
}

func objectPath(bucket, key string) string {
	parts := strings.Split(strings.Trim(strings.ReplaceAll(key, "\\", "/"), "/"), "/")
	clean := make([]string, 0, len(parts))
	for _, part := range parts {
		if part != "" && part != "." && part != ".." {
			clean = append(clean, part)
		}
	}
	return path.Join(append([]string{bucket}, clean...)...)
}

func responseError(response *http.Response) error {
	body, _ := io.ReadAll(io.LimitReader(response.Body, 16<<10))
	message := strings.TrimSpace(string(body))
	if message == "" {
		message = response.Status
	}
	return fmt.Errorf("MinIO request failed: %s", message)
}
