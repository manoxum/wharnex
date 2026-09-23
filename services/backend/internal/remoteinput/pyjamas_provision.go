package remoteinput

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
)

// fetchPyjamasConfigDocument provisions localPort and returns both the parsed
// data plane settings and the bounded raw document to retain privately.
func fetchPyjamasConfigDocument(ctx context.Context, client *http.Client, localPort int) (pyjamasConfig, string, error) {
	if localPort < 1024 || localPort > 65535 {
		return pyjamasConfig{}, "", errors.New("pyjam.as local port must be between 1024 and 65535")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://"+pyjamasHost+"/"+strconv.Itoa(localPort), nil)
	if err != nil {
		return pyjamasConfig{}, "", err
	}
	response, err := client.Do(request)
	if err != nil {
		return pyjamasConfig{}, "", fmt.Errorf("request pyjam.as tunnel: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return pyjamasConfig{}, "", fmt.Errorf("pyjam.as returned status %d", response.StatusCode)
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, pyjamasMaxConfigBytes+1))
	if err != nil {
		return pyjamasConfig{}, "", fmt.Errorf("read pyjam.as tunnel config: %w", err)
	}
	if len(raw) > pyjamasMaxConfigBytes {
		return pyjamasConfig{}, "", errors.New("pyjam.as tunnel config is too large")
	}
	parsed, err := parsePyjamasConfig(string(raw))
	if err != nil {
		return pyjamasConfig{}, "", err
	}
	if parsed.localPort != localPort {
		return pyjamasConfig{}, "", errors.New("pyjam.as tunnel config announced a different local port")
	}
	return parsed, string(raw), nil
}
