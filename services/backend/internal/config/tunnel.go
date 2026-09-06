package config

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"
)

type TunnelConfig struct {
	DaemonURL         string
	DaemonToken       string
	ConfigFile        string
	IndexFile         string
	SecretsDir        string
	LegacyStorageFile string
	LegacyProvider    string
}

type TunnelDocument struct {
	Version      int                    `json:"version"`
	InstanceName string                 `json:"instance_name,omitempty"`
	Instances    []TunnelInstanceConfig `json:"instances"`
}

type TunnelInstanceConfig struct {
	ID            string `json:"id"`
	Provider      string `json:"provider"`
	Priority      int    `json:"priority"`
	PublicURL     string `json:"public_url,omitempty"`
	CredentialRef string `json:"credential_ref,omitempty"`
	LocalPort     int    `json:"local_port,omitempty"`
}

func LoadTunnelInstances(cfg TunnelConfig) ([]TunnelInstanceConfig, error) {
	document, err := ReadTunnelDocument(cfg)
	if err != nil {
		return nil, err
	}
	instances := append([]TunnelInstanceConfig(nil), document.Instances...)
	sort.SliceStable(instances, func(i, j int) bool { return instances[i].Priority < instances[j].Priority })
	return instances, nil
}

const legacyDesktopDirectTunnelID = "desktop-direct"

func withoutDesktopDirect(document TunnelDocument) TunnelDocument {
	filtered := make([]TunnelInstanceConfig, 0, len(document.Instances))
	for _, instance := range document.Instances {
		if instance.Provider != "desktop_direct" {
			filtered = append(filtered, instance)
		}
	}
	document.Instances = filtered
	return document
}

// ReadTunnelDocument migrates the former TryCloudflare storage entry in memory
// until the dedicated tunnel configuration is saved by the user.
func ReadTunnelDocument(cfg TunnelConfig) (TunnelDocument, error) {
	if strings.TrimSpace(cfg.ConfigFile) == "" {
		return TunnelDocument{}, errors.New("tunnel config file is not configured")
	}
	raw, err := os.ReadFile(cfg.ConfigFile)
	if err == nil {
		document, decodeErr := DecodeTunnelDocument(raw)
		return withoutDesktopDirect(document), decodeErr
	}
	if !errors.Is(err, os.ErrNotExist) {
		return TunnelDocument{}, fmt.Errorf("read tunnel config: %w", err)
	}
	document, legacyErr := legacyTunnelDocument(cfg)
	return withoutDesktopDirect(document), legacyErr
}

func legacyTunnelDocument(cfg TunnelConfig) (TunnelDocument, error) {
	document := TunnelDocument{Version: 1, Instances: []TunnelInstanceConfig{}}
	if cfg.LegacyStorageFile != "" {
		legacy, exists, err := readRemoteStorageDocument(cfg.LegacyStorageFile)
		if err != nil {
			return TunnelDocument{}, err
		}
		if exists {
			for _, instance := range legacy.Instances {
				if strings.EqualFold(instance.Provider, "trycloudflare") {
					document.Instances = append(document.Instances, TunnelInstanceConfig{ID: instance.ID, Provider: "trycloudflare", Priority: instance.Priority})
				}
			}
			return document, validateTunnelInstances(document.Instances)
		}
	}
	if strings.EqualFold(strings.TrimSpace(cfg.LegacyProvider), "trycloudflare") {
		document.Instances = append(document.Instances, TunnelInstanceConfig{ID: "legacy-tunnel", Provider: "trycloudflare", Priority: 100})
	}
	return document, nil
}

func DecodeTunnelDocument(raw []byte) (TunnelDocument, error) {
	var document TunnelDocument
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&document); err != nil {
		return TunnelDocument{}, fmt.Errorf("decode tunnel config: %w", err)
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return TunnelDocument{}, errors.New("tunnel config must contain exactly one JSON document")
	}
	if document.Version != 1 {
		return TunnelDocument{}, errors.New("tunnel config version must be 1")
	}
	if document.Instances == nil {
		document.Instances = []TunnelInstanceConfig{}
	}
	if err := validateTunnelInstances(document.Instances); err != nil {
		return TunnelDocument{}, err
	}
	return withoutDesktopDirect(document), nil
}

func SaveTunnelDocument(cfg TunnelConfig, document TunnelDocument) error {
	if strings.TrimSpace(cfg.ConfigFile) == "" {
		return errors.New("tunnel config file is not configured")
	}
	if document.Version != 1 {
		return errors.New("tunnel config version must be 1")
	}
	if document.Instances == nil {
		document.Instances = []TunnelInstanceConfig{}
	}
	document = withoutDesktopDirect(document)
	document.InstanceName = strings.TrimSpace(document.InstanceName)
	if err := validateTunnelInstanceName(document.InstanceName, true); err != nil {
		return err
	}
	if err := validateTunnelInstances(document.Instances); err != nil {
		return err
	}
	dir := filepath.Dir(cfg.ConfigFile)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("create tunnel config directory: %w", err)
	}
	temporary, err := os.CreateTemp(dir, ".tunnel-providers-*.json")
	if err != nil {
		return err
	}
	name := temporary.Name()
	defer os.Remove(name)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return err
	}
	encoder := json.NewEncoder(temporary)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(document); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return os.Rename(name, cfg.ConfigFile)
}

func validateTunnelInstanceName(value string, required bool) error {
	if value == "" {
		if required {
			return errors.New("tunnel instance_name is required")
		}
		return nil
	}
	if utf8.RuneCountInString(value) > 80 {
		return errors.New("tunnel instance_name must contain at most 80 characters")
	}
	if strings.ContainsAny(value, "\r\n") || strings.IndexFunc(value, unicode.IsControl) >= 0 {
		return errors.New("tunnel instance_name cannot contain control characters")
	}
	return nil
}

func validateTunnelInstances(instances []TunnelInstanceConfig) error {
	if len(instances) > 16 {
		return errors.New("tunnel configuration supports at most 16 instances")
	}
	seen := make(map[string]struct{}, len(instances))
	for index, instance := range instances {
		if !instanceIDPattern.MatchString(instance.ID) {
			return fmt.Errorf("tunnel instance %d has invalid id", index+1)
		}
		if _, exists := seen[instance.ID]; exists {
			return fmt.Errorf("duplicate tunnel instance id %q", instance.ID)
		}
		seen[instance.ID] = struct{}{}
		provider := strings.ToLower(strings.TrimSpace(instance.Provider))
		if !supportedTunnelProvider(provider) && provider != "desktop_direct" {
			return fmt.Errorf("tunnel instance %q has unsupported provider", instance.ID)
		}
		if instance.Priority < 0 {
			return fmt.Errorf("tunnel instance %q priority cannot be negative", instance.ID)
		}
		if ephemeralTunnelProvider(provider) {
			if instance.PublicURL != "" || instance.CredentialRef != "" || instance.LocalPort != 0 {
				return fmt.Errorf("temporary tunnel instance %q cannot configure account fields", instance.ID)
			}
			continue
		}
		if provider == "desktop_direct" {
			if instance.ID != legacyDesktopDirectTunnelID || instance.PublicURL != "" || instance.CredentialRef != "" || instance.LocalPort != 0 {
				return fmt.Errorf("desktop direct instance must use the managed default configuration")
			}
			continue
		}
		if provider == "tailscale_funnel" {
			if instance.CredentialRef != "" {
				return fmt.Errorf("Tailscale Funnel instance %q cannot configure credential_ref", instance.ID)
			}
			if err := validateTunnelPublicURL(instance.PublicURL); err != nil {
				return fmt.Errorf("Tailscale Funnel instance %q public_url %w", instance.ID, err)
			}
			if instance.LocalPort < 1024 || instance.LocalPort > 65535 {
				return fmt.Errorf("Tailscale Funnel instance %q requires local_port between 1024 and 65535", instance.ID)
			}
			parsed, _ := url.Parse(instance.PublicURL)
			if !strings.HasSuffix(strings.ToLower(parsed.Hostname()), ".ts.net") {
				return fmt.Errorf("Tailscale Funnel instance %q public_url must use a .ts.net hostname", instance.ID)
			}
			continue
		}
		if !instanceIDPattern.MatchString(instance.CredentialRef) {
			return fmt.Errorf("tunnel instance %q requires a valid credential_ref", instance.ID)
		}
		if err := validateTunnelPublicURL(instance.PublicURL); err != nil {
			return fmt.Errorf("tunnel instance %q public_url %w", instance.ID, err)
		}
		if provider == "cloudflare_named" && (instance.LocalPort < 1024 || instance.LocalPort > 65535) {
			return fmt.Errorf("tunnel instance %q requires local_port between 1024 and 65535", instance.ID)
		}
		if provider == "ngrok" && instance.LocalPort != 0 {
			return fmt.Errorf("ngrok instance %q cannot set local_port", instance.ID)
		}
	}
	return nil
}

func supportedTunnelProvider(provider string) bool {
	switch provider {
	case "trycloudflare", "cloudflare_named", "ngrok", "zrok", "tailscale_funnel", "localxpose", "localhost_run", "pinggy", "serveo":
		return true
	default:
		return false
	}
}

func ephemeralTunnelProvider(provider string) bool {
	switch provider {
	case "trycloudflare", "zrok", "localxpose", "localhost_run", "pinggy", "serveo":
		return true
	default:
		return false
	}
}

func validateTunnelPublicURL(raw string) error {
	value, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || value.Scheme != "https" || value.Hostname() == "" || value.User != nil || value.RawQuery != "" || value.Fragment != "" || value.Path != "" {
		return errors.New("must be an HTTPS origin without path, userinfo, query, or fragment")
	}
	return nil
}
