package remoteinput

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os/exec"
	"time"
)

type cloudflaredStarter struct {
	command func(string, ...string) *exec.Cmd
}

func (starter cloudflaredStarter) Start(ctx context.Context, origin string) (*url.URL, func(), error) {
	// The caller context bounds tunnel startup only. The resulting process must
	// outlive that context and is owned by the returned stop function until the
	// main request channel reaches a terminal state.
	commandFactory := starter.command
	if commandFactory == nil {
		commandFactory = exec.Command
	}
	// HTTP/2 is materially more stable than QUIC on desktop/NAT networks and
	// avoids intermittent public-edge disconnects observed after publication.
	command := commandFactory("cloudflared", "tunnel", "--no-autoupdate", "--protocol", "http2", "--url", origin)
	output, err := command.StderrPipe()
	if err != nil {
		return nil, nil, err
	}
	standardOutput, err := command.StdoutPipe()
	if err != nil {
		return nil, nil, err
	}
	if err := command.Start(); err != nil {
		return nil, nil, fmt.Errorf("start cloudflared quick tunnel: %w", err)
	}
	result := make(chan *url.URL, 1)
	readURL := func(reader io.Reader) {
		scanner := bufio.NewScanner(reader)
		for scanner.Scan() {
			if match := tryCloudflareURLPattern.FindString(scanner.Text()); match != "" {
				parsed, parseErr := url.Parse(match)
				if parseErr == nil {
					select {
					case result <- parsed:
					default:
					}
				}
			}
		}
	}
	go readURL(output)
	go readURL(standardOutput)
	select {
	case tunnelURL := <-result:
		return tunnelURL, func() { _ = command.Process.Kill(); _ = command.Wait() }, nil
	case <-ctx.Done():
		_ = command.Process.Kill()
		_ = command.Wait()
		return nil, nil, ctx.Err()
	case <-time.After(45 * time.Second):
		_ = command.Process.Kill()
		_ = command.Wait()
		return nil, nil, errors.New("cloudflared quick tunnel did not provide a public URL")
	}
}

func waitQuickTunnelReachable(ctx context.Context, public *url.URL) error {
	probe := *public
	probe.Path = "/" + tryCloudflareReadinessPath
	client := &http.Client{Timeout: 4 * time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}
	ticker := time.NewTicker(400 * time.Millisecond)
	defer ticker.Stop()
	consecutiveSuccesses := 0
	for {
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, probe.String(), nil)
		if err != nil {
			return err
		}
		request.Close = true
		response, requestErr := client.Do(request)
		if requestErr == nil {
			_ = response.Body.Close()
			if response.StatusCode == http.StatusNoContent && response.Header.Get("X-Wharness-Tunnel") == "ready" {
				consecutiveSuccesses++
				if consecutiveSuccesses == 3 {
					return nil
				}
			} else {
				consecutiveSuccesses = 0
			}
		} else {
			consecutiveSuccesses = 0
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}

func probeTunnelReachable(ctx context.Context, public *url.URL) error {
	if public == nil {
		return errors.New("tunnel has no public URL")
	}
	probe := *public
	probe.Path = "/" + tryCloudflareReadinessPath
	request, err := http.NewRequestWithContext(ctx, http.MethodHead, probe.String(), nil)
	if err != nil {
		return err
	}
	request.Close = true
	response, err := (&http.Client{Timeout: 4 * time.Second}).Do(request)
	if err != nil {
		return err
	}
	_ = response.Body.Close()
	if response.StatusCode != http.StatusNoContent || response.Header.Get("X-Wharness-Tunnel") != "ready" {
		return fmt.Errorf("unexpected tunnel health status %d", response.StatusCode)
	}
	return nil
}
