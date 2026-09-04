package remoteinput

import (
	"context"
	"errors"
	"os/exec"
	"regexp"
	"sort"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/app"
)

const managedRemotePrefix = "wharness-"

var connectorIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`)

type connectorCommandRunner interface {
	Run(context.Context, ...string) error
}

type execConnectorRunner struct{}

func (execConnectorRunner) Run(ctx context.Context, args ...string) error {
	// Output may contain authorization URLs and provider details. It is never
	// returned to transports or logs.
	return exec.CommandContext(ctx, "rclone", args...).Run()
}

type RcloneConnector struct {
	runner    connectorCommandRunner
	available bool
}

func NewRcloneConnector() *RcloneConnector {
	_, err := exec.LookPath("rclone")
	return &RcloneConnector{runner: execConnectorRunner{}, available: err == nil}
}

func (c *RcloneConnector) Providers(context.Context) []app.RemoteStorageProvider {
	providers := providerCatalog()
	for index := range providers {
		providers[index].Available = c.available
	}
	return providers
}

func (c *RcloneConnector) Connect(ctx context.Context, request app.RemoteStorageConnectionRequest) (app.RemoteStorageConnection, error) {
	if !c.available {
		return app.RemoteStorageConnection{}, errors.New("rclone is not installed")
	}
	if !connectorIDPattern.MatchString(request.InstanceID) {
		return app.RemoteStorageConnection{}, errors.New("storage instance id is invalid")
	}
	spec, ok := connectorSpecs()[strings.ToLower(strings.TrimSpace(request.Provider))]
	if !ok {
		return app.RemoteStorageConnection{}, errors.New("storage provider is not supported")
	}
	for key, value := range request.Fields {
		limit := 4096
		if key != "secret_access_key" && key != "pass" {
			limit = 2048
		}
		if len(value) > limit {
			return app.RemoteStorageConnection{}, errors.New("storage provider field exceeds the supported length")
		}
	}
	options, err := spec.options(request.Fields)
	if err != nil {
		return app.RemoteStorageConnection{}, err
	}
	remote := managedRemotePrefix + request.InstanceID
	args := []string{"config", "create", remote, spec.backend}
	keys := make([]string, 0, len(options))
	for key := range options {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		args = append(args, key, options[key])
	}
	args = append(args, "--non-interactive", "--obscure")
	authCtx, cancel := context.WithTimeout(ctx, 15*time.Minute)
	defer cancel()
	if err := c.runner.Run(authCtx, args...); err != nil {
		if errors.Is(authCtx.Err(), context.DeadlineExceeded) {
			return app.RemoteStorageConnection{}, errors.New("browser authentication timed out")
		}
		return app.RemoteStorageConnection{}, errors.New("provider authentication was cancelled or failed")
	}
	return app.RemoteStorageConnection{Provider: request.Provider, Remote: remote, Connected: true, DisplayName: strings.TrimSpace(request.Fields["account_label"])}, nil
}

func (c *RcloneConnector) Disconnect(ctx context.Context, remote string) error {
	if !validManagedRemote(remote) {
		return errors.New("only Wharness-managed storage connections can be removed")
	}
	if err := c.runner.Run(ctx, "config", "delete", remote); err != nil {
		return errors.New("disconnect storage provider failed")
	}
	return nil
}

func (c *RcloneConnector) Check(ctx context.Context, remote string) error {
	if !validManagedRemote(remote) {
		return errors.New("storage remote is invalid")
	}
	checkCtx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	if err := c.runner.Run(checkCtx, "lsd", remote+":", "--max-depth", "1"); err != nil {
		return errors.New("storage connection test failed")
	}
	return nil
}

func validManagedRemote(remote string) bool {
	return strings.HasPrefix(remote, managedRemotePrefix) && connectorIDPattern.MatchString(strings.TrimPrefix(remote, managedRemotePrefix))
}

type connectorSpec struct {
	backend string
	options func(map[string]string) (map[string]string, error)
}

func connectorSpecs() map[string]connectorSpec {
	oauth := func(fields map[string]string) (map[string]string, error) {
		return map[string]string{"config_is_local": "true"}, nil
	}
	return map[string]connectorSpec{
		"drive":    {backend: "drive", options: oauth},
		"dropbox":  {backend: "dropbox", options: oauth},
		"onedrive": {backend: "onedrive", options: oauth},
		"box":      {backend: "box", options: oauth},
		"pcloud":   {backend: "pcloud", options: oauth},
		"s3": {backend: "s3", options: func(fields map[string]string) (map[string]string, error) {
			if strings.TrimSpace(fields["access_key_id"]) == "" || strings.TrimSpace(fields["secret_access_key"]) == "" {
				return nil, errors.New("S3 access key and secret key are required")
			}
			return selectedFields(fields, map[string]string{"s3_provider": "provider", "access_key_id": "access_key_id", "secret_access_key": "secret_access_key", "region": "region", "endpoint": "endpoint"}, map[string]string{"provider": "AWS", "env_auth": "false"}), nil
		}},
		"webdav":    {backend: "webdav", options: webDAVOptions("other")},
		"nextcloud": {backend: "webdav", options: webDAVOptions("nextcloud")},
	}
}

func webDAVOptions(vendor string) func(map[string]string) (map[string]string, error) {
	return func(fields map[string]string) (map[string]string, error) {
		if strings.TrimSpace(fields["url"]) == "" || strings.TrimSpace(fields["user"]) == "" || strings.TrimSpace(fields["pass"]) == "" {
			return nil, errors.New("WebDAV URL, username, and password are required")
		}
		return selectedFields(fields, map[string]string{"url": "url", "user": "user", "pass": "pass"}, map[string]string{"vendor": vendor}), nil
	}
}

func selectedFields(fields, mapping, defaults map[string]string) map[string]string {
	result := make(map[string]string, len(mapping)+len(defaults))
	for key, value := range defaults {
		result[key] = value
	}
	for source, target := range mapping {
		if value := strings.TrimSpace(fields[source]); value != "" {
			result[target] = value
		}
	}
	return result
}

func providerCatalog() []app.RemoteStorageProvider {
	text := func(id, label, placeholder string, required bool) app.RemoteStorageField {
		return app.RemoteStorageField{ID: id, Label: label, Placeholder: placeholder, Required: required}
	}
	secret := func(id, label string) app.RemoteStorageField {
		return app.RemoteStorageField{ID: id, Label: label, Secret: true, Required: true}
	}
	return []app.RemoteStorageProvider{
		{ID: "drive", Name: "Google Drive", Description: "Autenticação Google numa janela do navegador.", AuthMode: "oauth_browser", Fields: nil},
		{ID: "dropbox", Name: "Dropbox", Description: "Liga uma conta Dropbox pelo navegador.", AuthMode: "oauth_browser", Fields: nil},
		{ID: "onedrive", Name: "Microsoft OneDrive", Description: "Conta pessoal ou empresarial Microsoft.", AuthMode: "oauth_browser", Fields: nil},
		{ID: "s3", Name: "Amazon S3 / compatível", Description: "AWS, MinIO, Cloudflare R2 e endpoints compatíveis.", AuthMode: "credentials", Fields: []app.RemoteStorageField{text("s3_provider", "Implementação S3", "AWS", false), text("region", "Região", "eu-west-1", false), text("endpoint", "Endpoint personalizado", "https://…", false), text("access_key_id", "Access key", "", true), secret("secret_access_key", "Secret key")}},
		{ID: "nextcloud", Name: "Nextcloud", Description: "Servidor próprio através de WebDAV.", AuthMode: "credentials", Fields: []app.RemoteStorageField{text("url", "URL WebDAV", "https://cloud.example/remote.php/dav/files/user", true), text("user", "Utilizador", "", true), secret("pass", "Password de aplicação")}},
		{ID: "webdav", Name: "WebDAV", Description: "Qualquer servidor WebDAV público ou privado.", AuthMode: "credentials", Fields: []app.RemoteStorageField{text("url", "URL WebDAV", "https://storage.example/dav", true), text("user", "Utilizador", "", true), secret("pass", "Password")}},
		{ID: "box", Name: "Box", Description: "Liga uma conta Box pelo navegador.", AuthMode: "oauth_browser", Fields: nil},
		{ID: "pcloud", Name: "pCloud", Description: "Liga uma conta pCloud pelo navegador.", AuthMode: "oauth_browser", Fields: nil},
	}
}
