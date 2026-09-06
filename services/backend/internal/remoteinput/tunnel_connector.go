package remoteinput

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/app"
)

type tunnelCredential struct {
	Provider string `json:"provider"`
	Token    string `json:"token"`
}

type TunnelConnector struct{ secretsDir string }

func NewTunnelConnector(secretsDir string) *TunnelConnector {
	return &TunnelConnector{secretsDir: secretsDir}
}

func TunnelProviders() []app.TunnelProviderDescriptor {
	field := func(id, label, placeholder string, secret bool) app.RemoteStorageField {
		return app.RemoteStorageField{ID: id, Label: label, Placeholder: placeholder, Secret: secret, Required: true}
	}
	_, cloudflareErr := exec.LookPath("cloudflared")
	_, ngrokErr := exec.LookPath("ngrok")
	_, zrokErr := exec.LookPath("zrok")
	_, localxposeErr := exec.LookPath("loclx")
	_, sshErr := exec.LookPath("ssh")
	_, tailscaleErr := exec.LookPath("tailscale")
	return []app.TunnelProviderDescriptor{
		{ID: "cloudflare_named", Name: "Cloudflare Named Tunnel", Description: "Conta Cloudflare, túnel remoto e hostname DNS permanente.", AuthMode: "token", AuthURL: "https://one.dash.cloudflare.com/", Permanent: true, Available: cloudflareErr == nil, Fields: []app.RemoteStorageField{field("token", "Tunnel token", "Token do dashboard Cloudflare", true), field("public_url", "Hostname público", "https://agent.example.com", false), field("local_port", "Porta local configurada no tunnel", "43127", false)}},
		{ID: "ngrok", Name: "ngrok Reserved Domain", Description: "Conta gratuita com domínio de desenvolvimento estável.", AuthMode: "token", AuthURL: "https://dashboard.ngrok.com/get-started/your-authtoken", Permanent: true, Available: ngrokErr == nil, Fields: []app.RemoteStorageField{field("token", "Authtoken", "Token da conta ngrok", true), field("public_url", "Domínio reservado", "https://example.ngrok.app", false)}},
		{ID: "trycloudflare", Name: "Cloudflare Quick Tunnel", Description: "Compatibilidade temporária sem conta ou DNS permanente.", AuthMode: "none", Permanent: false, Available: cloudflareErr == nil, Fields: []app.RemoteStorageField{}},
		{ID: "zrok", Name: "zrok Public Share", Description: "Partilha HTTPS temporária; reutiliza um ambiente zrok ativado localmente.", AuthMode: "local", AuthURL: "https://myzrok.io/", Permanent: false, Available: zrokErr == nil, Fields: []app.RemoteStorageField{}},
		{ID: "tailscale_funnel", Name: "Tailscale Funnel", Description: "HTTPS estável em .ts.net; reutiliza o login local e um Funnel já autorizado.", AuthMode: "local", AuthURL: "https://login.tailscale.com/admin", Permanent: true, Available: tailscaleErr == nil, Fields: []app.RemoteStorageField{field("public_url", "URL pública .ts.net", "https://machine.tailnet.ts.net", false), field("local_port", "Porta loopback configurada no Funnel", "43127", false)}},
		{ID: "localxpose", Name: "LocalXpose", Description: "Túnel HTTPS temporário pelo cliente LocalXpose configurado localmente.", AuthMode: "none", Permanent: false, Available: localxposeErr == nil, Fields: []app.RemoteStorageField{}},
		{ID: "localhost_run", Name: "localhost.run", Description: "Túnel HTTPS temporário via SSH, sem comando livre ou encaminhamento arbitrário.", AuthMode: "none", Permanent: false, Available: sshErr == nil, Fields: []app.RemoteStorageField{}},
		{ID: "pinggy", Name: "Pinggy", Description: "Túnel HTTPS temporário via SSH; o limite da conta gratuita é imposto pelo provider.", AuthMode: "none", Permanent: false, Available: sshErr == nil, Fields: []app.RemoteStorageField{}},
		{ID: "serveo", Name: "Serveo", Description: "Túnel HTTPS comunitário via SSH; disponibilidade e subdomínio são do provider.", AuthMode: "none", Permanent: false, Available: sshErr == nil, Fields: []app.RemoteStorageField{}},
	}
}

func (c *TunnelConnector) Enroll(ctx context.Context, request app.TunnelProviderEnrollmentRequest) (app.TunnelProviderEnrollment, error) {
	if !connectorIDPattern.MatchString(request.InstanceID) {
		return app.TunnelProviderEnrollment{}, errors.New("tunnel instance id is invalid")
	}
	provider := strings.ToLower(strings.TrimSpace(request.Provider))
	if provider != "cloudflare_named" && provider != "ngrok" {
		return app.TunnelProviderEnrollment{}, errors.New("tunnel provider does not use account enrollment")
	}
	executable := "cloudflared"
	if provider == "ngrok" {
		executable = "ngrok"
	}
	if _, err := exec.LookPath(executable); err != nil {
		return app.TunnelProviderEnrollment{}, fmt.Errorf("%s executable is not installed", executable)
	}
	token := strings.TrimSpace(request.Fields["token"])
	if token == "" || len(token) > 8192 || strings.ContainsAny(token, "\x00\r\n") {
		return app.TunnelProviderEnrollment{}, errors.New("tunnel account token is invalid")
	}
	publicURL, err := normalizeTunnelPublicURL(request.Fields["public_url"])
	if err != nil {
		return app.TunnelProviderEnrollment{}, err
	}
	localPort := 0
	if provider == "cloudflare_named" {
		localPort, err = strconv.Atoi(strings.TrimSpace(request.Fields["local_port"]))
		if err != nil || localPort < 1024 || localPort > 65535 {
			return app.TunnelProviderEnrollment{}, errors.New("Cloudflare local port must be between 1024 and 65535")
		}
	}
	parsedPublic, _ := url.Parse(publicURL)
	validationCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	_, stop, validationErr := (accountTunnelStarter{provider: provider, token: token, public: parsedPublic}).Start(validationCtx, "http://127.0.0.1:1")
	cancel()
	if stop != nil {
		stop()
	}
	if validationErr != nil {
		return app.TunnelProviderEnrollment{}, fmt.Errorf("tunnel account or permanent domain was rejected by %s: %w", provider, validationErr)
	}
	credentialRef := request.InstanceID
	if err := c.writeCredential(credentialRef, tunnelCredential{Provider: provider, Token: token}); err != nil {
		return app.TunnelProviderEnrollment{}, err
	}
	return app.TunnelProviderEnrollment{Provider: provider, CredentialRef: credentialRef, PublicURL: publicURL, LocalPort: localPort}, nil
}

func (c *TunnelConnector) Disconnect(_ context.Context, credentialRef string) error {
	path, err := c.credentialPath(credentialRef)
	if err != nil {
		return err
	}
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("remove tunnel credential: %w", err)
	}
	return nil
}

func (c *TunnelConnector) writeCredential(ref string, credential tunnelCredential) error {
	path, err := c.credentialPath(ref)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(c.secretsDir, 0o700); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(c.secretsDir, ".tunnel-credential-*.json")
	if err != nil {
		return err
	}
	name := temporary.Name()
	defer os.Remove(name)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return err
	}
	encodeErr := json.NewEncoder(temporary).Encode(credential)
	closeErr := temporary.Close()
	if encodeErr != nil {
		return encodeErr
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(name, path)
}

func (c *TunnelConnector) credentialPath(ref string) (string, error) {
	if !connectorIDPattern.MatchString(ref) || strings.TrimSpace(c.secretsDir) == "" {
		return "", errors.New("tunnel credential reference is invalid")
	}
	return filepath.Join(c.secretsDir, ref+".json"), nil
}

func readTunnelCredential(secretsDir, ref, provider string) (tunnelCredential, error) {
	connector := NewTunnelConnector(secretsDir)
	path, err := connector.credentialPath(ref)
	if err != nil {
		return tunnelCredential{}, err
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return tunnelCredential{}, fmt.Errorf("read tunnel credential %q: %w", ref, err)
	}
	var credential tunnelCredential
	if json.Unmarshal(raw, &credential) != nil || credential.Provider != provider || credential.Token == "" {
		return tunnelCredential{}, errors.New("tunnel credential is invalid")
	}
	return credential, nil
}

func normalizeTunnelPublicURL(raw string) (string, error) {
	value := strings.TrimSpace(raw)
	if !strings.Contains(value, "://") {
		value = "https://" + value
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme != "https" || parsed.Hostname() == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || parsed.Path != "" {
		return "", errors.New("tunnel public URL must be an HTTPS origin without a path")
	}
	return parsed.String(), nil
}
