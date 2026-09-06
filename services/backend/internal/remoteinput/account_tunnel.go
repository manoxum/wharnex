package remoteinput

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

type AccountTunnelConfig struct {
	Provider      string
	StorageDir    string
	SecretsDir    string
	CredentialRef string
	PublicURL     string
	LocalPort     int
	Landing       TunnelLanding
}

type accountTunnelStarter struct {
	provider string
	token    string
	public   *url.URL
}

var ngrokErrorCodePattern = regexp.MustCompile(`ERR_NGROK_[0-9]+`)

type boundedTunnelOutput struct{ value []byte }

func (output *boundedTunnelOutput) Write(raw []byte) (int, error) {
	const limit = 32 << 10
	if len(output.value) < limit {
		remaining := limit - len(output.value)
		output.value = append(output.value, raw[:min(len(raw), remaining)]...)
	}
	return len(raw), nil
}

func NewAccountTunnelProvider(cfg AccountTunnelConfig) (*TryCloudflareProvider, error) {
	provider := strings.ToLower(strings.TrimSpace(cfg.Provider))
	if provider != "cloudflare_named" && provider != "ngrok" {
		return nil, errors.New("unsupported account tunnel provider")
	}
	credential, err := readTunnelCredential(cfg.SecretsDir, cfg.CredentialRef, provider)
	if err != nil {
		return nil, err
	}
	publicText, err := normalizeTunnelPublicURL(cfg.PublicURL)
	if err != nil {
		return nil, err
	}
	public, _ := url.Parse(publicText)
	listenAddr := "127.0.0.1:0"
	if provider == "cloudflare_named" {
		if cfg.LocalPort < 1024 || cfg.LocalPort > 65535 {
			return nil, errors.New("Cloudflare named tunnel requires a local port between 1024 and 65535")
		}
		listenAddr = "127.0.0.1:" + strconv.Itoa(cfg.LocalPort)
	}
	starter := accountTunnelStarter{provider: provider, token: credential.Token, public: public}
	return newTunnelProvider(cfg.StorageDir, provider, listenAddr, true, starter, cfg.Landing, func(candidate *url.URL) bool {
		return candidate != nil && candidate.String() == public.String()
	})
}

func (starter accountTunnelStarter) Start(ctx context.Context, origin string) (*url.URL, func(), error) {
	var command *exec.Cmd
	switch starter.provider {
	case "cloudflare_named":
		command = exec.Command("cloudflared", "tunnel", "--no-autoupdate", "--protocol", "http2", "run")
		command.Env = append(os.Environ(), "TUNNEL_TOKEN="+starter.token)
	case "ngrok":
		command = exec.Command("ngrok", "http", origin, "--url", starter.public.String(), "--log", "stdout")
		command.Env = append(os.Environ(), "NGROK_AUTHTOKEN="+starter.token)
	default:
		return nil, nil, errors.New("unsupported account tunnel provider")
	}
	command.Stdout = io.Discard
	var diagnostics boundedTunnelOutput
	command.Stderr = &diagnostics
	if err := command.Start(); err != nil {
		return nil, nil, fmt.Errorf("start %s tunnel: %w", starter.provider, err)
	}
	done := make(chan error, 1)
	go func() { done <- command.Wait() }()
	var once sync.Once
	stop := func() {
		once.Do(func() {
			if command.Process != nil {
				_ = command.Process.Kill()
			}
			select {
			case <-done:
			case <-time.After(5 * time.Second):
			}
		})
	}
	select {
	case err := <-done:
		if code := ngrokErrorCodePattern.FindString(string(diagnostics.value)); code != "" {
			return nil, nil, fmt.Errorf("%s rejected the configured account or domain (%s)", starter.provider, code)
		}
		if err == nil {
			err = errors.New("process exited")
		}
		return nil, nil, fmt.Errorf("%s tunnel exited during startup: %w", starter.provider, err)
	case <-ctx.Done():
		stop()
		return nil, nil, ctx.Err()
	case <-time.After(2 * time.Second):
		return starter.public, stop, nil
	}
}
