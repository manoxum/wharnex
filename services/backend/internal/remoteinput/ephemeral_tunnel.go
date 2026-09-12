package remoteinput

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os/exec"
	"regexp"
	"strings"
	"sync"
	"time"
)

type ephemeralTunnelProfile struct {
	provider   string
	executable string
	args       func(string) []string
	urlPattern *regexp.Regexp
	validHost  func(string) bool
}

// NewEphemeralTunnelProvider starts one allowlisted tunnel client for the
// loopback-only Wharnex resource server. It deliberately has no facility for
// user-provided command fragments, hosts, or SSH options.
func NewEphemeralTunnelProvider(provider, storageDir string, landing TunnelLanding) (*TryCloudflareProvider, error) {
	profile, ok := ephemeralTunnelProfiles()[provider]
	if !ok {
		return nil, errors.New("unsupported ephemeral tunnel provider")
	}
	if _, err := exec.LookPath(profile.executable); err != nil {
		return nil, fmt.Errorf("%s executable was not found", profile.executable)
	}
	starter := commandTunnelStarter{profile: profile}
	return newTunnelProvider(storageDir, provider, "127.0.0.1:0", false, starter, landing, func(public *url.URL) bool {
		return public != nil && public.Scheme == "https" && public.User == nil && profile.validHost(strings.ToLower(public.Hostname()))
	})
}

func ephemeralTunnelProfiles() map[string]ephemeralTunnelProfile {
	sshArgs := func(host string) func(string) []string {
		return func(origin string) []string {
			parsed, _ := url.Parse(origin)
			return []string{"-T", "-o", "BatchMode=yes", "-o", "ExitOnForwardFailure=yes", "-R", "80:" + parsed.Host, host}
		}
	}
	endsWith := func(suffix string) func(string) bool {
		return func(host string) bool { return strings.HasSuffix(host, suffix) }
	}
	return map[string]ephemeralTunnelProfile{
		"zrok": {"zrok", "zrok", func(origin string) []string { return []string{"share", "public", "--headless", origin} }, regexp.MustCompile(`https://[a-z0-9-]+\.share\.zrok\.io`), endsWith(".share.zrok.io")},
		"localxpose": {"localxpose", "loclx", func(origin string) []string { return []string{"tunnel", "http", "--to", origin} }, regexp.MustCompile(`https://[a-z0-9-]+\.(?:loclx\.io|localxpose\.io)`), func(host string) bool {
			return strings.HasSuffix(host, ".loclx.io") || strings.HasSuffix(host, ".localxpose.io")
		}},
		"localhost_run": {"localhost_run", "ssh", sshArgs("nokey@localhost.run"), regexp.MustCompile(`https://[a-z0-9-]+\.lhr\.life|https://[a-z0-9-]+\.localhost\.run`), func(host string) bool {
			return strings.HasSuffix(host, ".lhr.life") || strings.HasSuffix(host, ".localhost.run")
		}},
		"pinggy": {"pinggy", "ssh", func(origin string) []string {
			parsed, _ := url.Parse(origin)
			return []string{"-p", "443", "-T", "-o", "BatchMode=yes", "-o", "ExitOnForwardFailure=yes", "-R", "0:" + parsed.Host, "a.pinggy.io"}
		}, regexp.MustCompile(`https://[a-z0-9-]+\.pinggy\.link`), endsWith(".pinggy.link")},
		"serveo": {"serveo", "ssh", sshArgs("serveo.net"), regexp.MustCompile(`https://[a-z0-9-]+\.serveo\.net`), endsWith(".serveo.net")},
	}
}

type commandTunnelStarter struct{ profile ephemeralTunnelProfile }

func (starter commandTunnelStarter) Start(ctx context.Context, origin string) (*url.URL, func(), error) {
	command := exec.Command(starter.profile.executable, starter.profile.args(origin)...)
	stdout, err := command.StdoutPipe()
	if err != nil {
		return nil, nil, err
	}
	stderr, err := command.StderrPipe()
	if err != nil {
		return nil, nil, err
	}
	if err := command.Start(); err != nil {
		return nil, nil, fmt.Errorf("start %s: %w", starter.profile.provider, err)
	}
	result := make(chan *url.URL, 1)
	readURL := func(reader io.Reader) {
		scanner := bufio.NewScanner(reader)
		for scanner.Scan() {
			match := starter.profile.urlPattern.FindString(scanner.Text())
			if parsed, err := url.Parse(match); match != "" && err == nil {
				select {
				case result <- parsed:
				default:
				}
			}
		}
	}
	go readURL(stdout)
	go readURL(stderr)
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
	case public := <-result:
		return public, stop, nil
	case err := <-done:
		if err == nil {
			err = errors.New("process exited")
		}
		return nil, nil, fmt.Errorf("%s exited before providing a public URL: %w", starter.profile.provider, err)
	case <-ctx.Done():
		stop()
		return nil, nil, ctx.Err()
	case <-time.After(45 * time.Second):
		stop()
		return nil, nil, fmt.Errorf("%s did not provide a public HTTPS URL", starter.profile.provider)
	}
}
