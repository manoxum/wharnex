package tunneldaemon

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"

	"kernl.local/harness/backend/internal/app"
)

type Client struct {
	baseURL string
	token   string
	http    *http.Client
}

func NewClient(baseURL, token string) (*Client, error) {
	validated, err := validateBaseURL(baseURL)
	if err != nil {
		return nil, err
	}
	if token == "" {
		return nil, errors.New("tunnel daemon token is required")
	}
	return &Client{baseURL: validated, token: token, http: &http.Client{Timeout: 2 * time.Minute}}, nil
}

func (c *Client) request(ctx context.Context, method, path string, input, output any) error {
	var body io.Reader
	if input != nil {
		raw, err := json.Marshal(input)
		if err != nil {
			return err
		}
		body = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, body)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	if input != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	response, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("tunnel daemon request: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		raw, _ := io.ReadAll(io.LimitReader(response.Body, 16<<10))
		return fmt.Errorf("tunnel daemon %s: %s", response.Status, bytes.TrimSpace(raw))
	}
	if output == nil || response.StatusCode == http.StatusNoContent {
		return nil
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 16<<20)).Decode(output); err != nil {
		return fmt.Errorf("decode tunnel daemon response: %w", err)
	}
	return nil
}

func (c *Client) Providers(ctx context.Context) ([]app.TunnelProviderDescriptor, error) {
	var response struct {
		Providers []app.TunnelProviderDescriptor `json:"providers"`
	}
	if err := c.request(ctx, http.MethodGet, APIPathProviders, nil, &response); err != nil {
		return nil, err
	}
	return response.Providers, nil
}

func (c *Client) Status() app.RemoteInputStatus {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	var status app.RemoteInputStatus
	if err := c.request(ctx, http.MethodGet, APIPathStatus, nil, &status); err != nil {
		return app.RemoteInputStatus{Mode: "tunnel", Instances: []app.RemoteInputInstanceStatus{{ID: "tunnel-daemon", Provider: "daemon", Available: false, Error: err.Error()}}}
	}
	return status
}

func (c *Client) Publish(ctx context.Context, object app.RemoteInputObject) (app.RemoteInputPublication, error) {
	var result app.RemoteInputPublication
	if err := c.request(ctx, http.MethodPost, APIPathPublish, object, &result); err != nil {
		return app.RemoteInputPublication{}, err
	}
	return result, nil
}

func (c *Client) RetainRemoteInput(instanceID, objectName string) error {
	return c.request(context.Background(), http.MethodPost, APIPathRetain, instanceObjectRequest{instanceID, objectName}, nil)
}

func (c *Client) ReleaseRemoteInput(instanceID, objectName string) error {
	return c.request(context.Background(), http.MethodPost, APIPathRelease, instanceObjectRequest{instanceID, objectName}, nil)
}

// ReloadRemoteInput asks the daemon to adopt the saved tunnel configuration.
// The backend never sends provider definitions: the daemon re-reads the shared
// document itself, keeping provider lifetime on its side of the boundary.
func (c *Client) ReloadRemoteInput(ctx context.Context) error {
	return c.request(ctx, http.MethodPost, APIPathReload, struct{}{}, nil)
}

func (c *Client) SupportsRemoteInputChannels() bool { return true }

func (c *Client) PublishRemoteInputChannel(ctx context.Context, channel app.RemoteInputChannel) (app.RemoteInputPublication, error) {
	var result app.RemoteInputPublication
	if err := c.request(ctx, http.MethodPost, APIPathChannels, channel, &result); err != nil {
		return app.RemoteInputPublication{}, err
	}
	return result, nil
}

func (c *Client) PublishRemoteInputChannelSet(ctx context.Context, channel app.RemoteInputChannel) ([]app.RemoteInputPublication, error) {
	var result []app.RemoteInputPublication
	if err := c.request(ctx, http.MethodPost, APIPathChannelSet, channel, &result); err != nil {
		return nil, err
	}
	return result, nil
}

func (c *Client) UpdateRemoteInputChannel(ctx context.Context, instanceID string, update app.RemoteInputChannelUpdate) error {
	return c.request(ctx, http.MethodPut, APIPathChannel, struct {
		InstanceID string                       `json:"instance_id"`
		Update     app.RemoteInputChannelUpdate `json:"update"`
	}{instanceID, update}, nil)
}

func (c *Client) UpdateRemoteInputChannelSet(ctx context.Context, instanceIDs []string, update app.RemoteInputChannelUpdate) error {
	return c.request(ctx, http.MethodPut, APIPathChannelSet, struct {
		InstanceIDs []string                     `json:"instance_ids"`
		Update      app.RemoteInputChannelUpdate `json:"update"`
	}{instanceIDs, update}, nil)
}

func (c *Client) CloseRemoteInputChannel(ctx context.Context, instanceID, channelID string) error {
	return c.request(ctx, http.MethodDelete, APIPathChannel, instanceChannelRequest{instanceID, channelID}, nil)
}

func (c *Client) CloseRemoteInputChannelSet(ctx context.Context, instanceIDs []string, channelID string) error {
	return c.request(ctx, http.MethodDelete, APIPathChannelSet, closeChannelSetRequest{instanceIDs, channelID}, nil)
}

func (c *Client) StartRemoteInputSession(ctx context.Context) error {
	return c.request(ctx, http.MethodPost, APIPathSessionStart, nil, nil)
}

// Stop is intentionally a no-op. The tunnel daemon owns tunnel lifetime and
// survives backend/Desktop restarts. Only stack lifecycle stops the daemon.
func (c *Client) StopRemoteInputSession(context.Context) error { return nil }

func (c *Client) ClearRemoteInputSession(ctx context.Context) error {
	return c.request(ctx, http.MethodPost, APIPathSessionClear, nil, nil)
}

func (c *Client) Cleanup(ctx context.Context, cutoff time.Time) error {
	return c.request(ctx, http.MethodPost, APIPathCleanup, cleanupRequest{Cutoff: cutoff.UTC().Format(time.RFC3339Nano)}, nil)
}

func (c *Client) Enroll(ctx context.Context, request app.TunnelProviderEnrollmentRequest) (app.TunnelProviderEnrollment, error) {
	var result app.TunnelProviderEnrollment
	if err := c.request(ctx, http.MethodPost, APIPathEnroll, request, &result); err != nil {
		return app.TunnelProviderEnrollment{}, err
	}
	return result, nil
}

func (c *Client) Disconnect(ctx context.Context, credentialRef string) error {
	return c.request(ctx, http.MethodPost, APIPathDisconnect, map[string]string{"credential_ref": credentialRef}, nil)
}
