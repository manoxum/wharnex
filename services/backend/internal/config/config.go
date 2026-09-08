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
	"regexp"
	"strconv"
	"strings"

	"kernl.local/harness/backend/internal/app"
)

type Config struct {
	Addr               string
	DatabaseURL        string
	Planner            string
	Sandbox            string
	RunnerImage        string
	OpenAIAPIKey       string
	OpenAIModel        string
	OpenAIBaseURL      string
	MaxContextBytes    int64
	MaxBundleBytes     int64
	AllowLocalSandbox  bool
	FrontendOrigin     string
	InstanceID         string
	StateFile          string
	DependencyCacheDir string
	RemoteStorage      RemoteStorageConfig
	Tunnel             TunnelConfig
	Artifacts          ArtifactStorageConfig
}

type ArtifactStorageConfig struct {
	Endpoint     string
	AccessKey    string
	SecretKey    string
	Bucket       string
	Region       string
	SettingsFile string
}

type ArtifactSettingsDocument struct {
	Version           int `json:"version"`
	RetentionDays     int `json:"retention_days"`
	BundleWindowLimit int `json:"bundle_window_limit"`
}

type RemoteStorageConfig struct {
	ConfigFile    string
	Provider      string
	UploadURL     string
	PublicURL     string
	Authorization string
	RcloneRemote  string
	RclonePrefix  string
	IndexFile     string
}

type RemoteStorageDocument struct {
	Version   int                           `json:"version"`
	Instances []RemoteStorageInstanceConfig `json:"instances"`
}

type RemoteStorageInstanceConfig struct {
	ID               string                `json:"id"`
	Provider         string                `json:"provider"`
	Priority         int                   `json:"priority"`
	Limits           app.RemoteInputLimits `json:"limits"`
	UploadURL        string                `json:"upload_url,omitempty"`
	PublicURL        string                `json:"public_url,omitempty"`
	AuthorizationEnv string                `json:"authorization_env,omitempty"`
	RcloneRemote     string                `json:"rclone_remote,omitempty"`
	RclonePrefix     string                `json:"rclone_prefix,omitempty"`
	Authorization    string                `json:"-"`
}

var (
	instanceIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`)
	envNamePattern    = regexp.MustCompile(`^[A-Z_][A-Z0-9_]{0,127}$`)
)

func Load() Config {
	stateFile := env("HARNESS_STATE_FILE", defaultStateFile())
	remoteStorage := RemoteStorageConfig{
		ConfigFile:    env("HARNESS_REMOTE_STORAGE_CONFIG_FILE", remoteConfigFile(stateFile)),
		Provider:      env("HARNESS_REMOTE_STORAGE_PROVIDER", ""),
		UploadURL:     env("HARNESS_REMOTE_STORAGE_UPLOAD_URL", ""),
		PublicURL:     env("HARNESS_REMOTE_STORAGE_PUBLIC_URL", ""),
		Authorization: os.Getenv("HARNESS_REMOTE_STORAGE_AUTHORIZATION"),
		RcloneRemote:  env("HARNESS_REMOTE_STORAGE_RCLONE_REMOTE", ""),
		RclonePrefix:  env("HARNESS_REMOTE_STORAGE_RCLONE_PREFIX", "wharness-inputs"),
		IndexFile:     remoteIndexFile(stateFile),
	}
	return Config{
		Addr:               env("HARNESS_ADDR", "127.0.0.1:8080"),
		FrontendOrigin:     env("HARNESS_FRONTEND_ORIGIN", "http://127.0.0.1:5173"),
		InstanceID:         env("HARNESS_INSTANCE_ID", ""),
		DatabaseURL:        strings.TrimSpace(os.Getenv("HARNESS_DATABASE_URL")),
		Planner:            env("HARNESS_PLANNER", "manual"),
		Sandbox:            env("HARNESS_SANDBOX", "docker"),
		RunnerImage:        env("HARNESS_RUNNER_IMAGE", "kernl-runner:local"),
		OpenAIAPIKey:       os.Getenv("OPENAI_API_KEY"),
		OpenAIModel:        env("OPENAI_MODEL", "gpt-5.6-sol"),
		OpenAIBaseURL:      env("OPENAI_BASE_URL", "https://api.openai.com/v1"),
		MaxContextBytes:    envInt64("HARNESS_MAX_CONTEXT_BYTES", 4*1024*1024),
		MaxBundleBytes:     envInt64("HARNESS_MAX_BUNDLE_BYTES", 128*1024*1024),
		AllowLocalSandbox:  envBool("HARNESS_ALLOW_LOCAL_SANDBOX", false),
		StateFile:          stateFile,
		DependencyCacheDir: env("HARNESS_DEPENDENCY_CACHE_DIR", filepath.Join(filepath.Dir(stateFile), "dependency-cache")),
		Artifacts: ArtifactStorageConfig{
			Endpoint:     env("HARNESS_ARTIFACT_ENDPOINT", "http://minio:9000"),
			AccessKey:    env("HARNESS_ARTIFACT_ACCESS_KEY", "wharness"),
			SecretKey:    os.Getenv("HARNESS_ARTIFACT_SECRET_KEY"),
			Bucket:       env("HARNESS_ARTIFACT_BUCKET", "wharness-artifacts"),
			Region:       env("HARNESS_ARTIFACT_REGION", "us-east-1"),
			SettingsFile: filepath.Join(filepath.Dir(stateFile), "artifact-storage.json"),
		},
		RemoteStorage: remoteStorage,
		Tunnel: TunnelConfig{
			DaemonURL:         env("HARNESS_TUNNEL_DAEMON_URL", ""),
			DaemonToken:       os.Getenv("HARNESS_TUNNEL_DAEMON_TOKEN"),
			ConfigFile:        env("HARNESS_TUNNEL_CONFIG_FILE", tunnelConfigFile(stateFile)),
			IndexFile:         tunnelIndexFile(stateFile),
			SecretsDir:        filepath.Join(filepath.Dir(stateFile), "tunnel-credentials"),
			LegacyStorageFile: remoteStorage.ConfigFile,
			LegacyProvider:    remoteStorage.Provider,
		},
	}
}

func LoadRemoteStorageInstances(cfg RemoteStorageConfig) ([]RemoteStorageInstanceConfig, error) {
	if cfg.ConfigFile != "" {
		document, exists, err := readRemoteStorageDocument(cfg.ConfigFile)
		if err != nil {
			return nil, err
		}
		if exists {
			return hydrateRemoteSecrets(document.Instances)
		}
	}
	if strings.TrimSpace(cfg.Provider) == "" {
		return nil, nil
	}
	legacy := RemoteStorageInstanceConfig{
		ID: "legacy-default", Provider: cfg.Provider, Priority: 100,
		UploadURL: cfg.UploadURL, PublicURL: cfg.PublicURL, RcloneRemote: cfg.RcloneRemote,
		RclonePrefix: cfg.RclonePrefix, Authorization: cfg.Authorization,
	}
	if err := validateRemoteInstances([]RemoteStorageInstanceConfig{legacy}); err != nil {
		return nil, err
	}
	return []RemoteStorageInstanceConfig{legacy}, nil
}

// ReadRemoteStorageDocument returns the editable, secret-free storage pool configuration.
// A missing file is represented by a valid empty v1 document.
func ReadRemoteStorageDocument(cfg RemoteStorageConfig) (RemoteStorageDocument, error) {
	document, exists, err := readRemoteStorageDocument(cfg.ConfigFile)
	if err != nil {
		return RemoteStorageDocument{}, err
	}
	if !exists {
		return RemoteStorageDocument{Version: 1, Instances: []RemoteStorageInstanceConfig{}}, nil
	}
	return document, nil
}

func readRemoteStorageDocument(path string) (RemoteStorageDocument, bool, error) {
	if strings.TrimSpace(path) == "" {
		return RemoteStorageDocument{}, false, errors.New("remote storage config file is not configured")
	}
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return RemoteStorageDocument{}, false, nil
	}
	if err != nil {
		return RemoteStorageDocument{}, false, fmt.Errorf("read remote storage config: %w", err)
	}
	document, err := DecodeRemoteStorageDocument(raw)
	return document, true, err
}

// DecodeRemoteStorageDocument strictly decodes and validates one JSON document.
func DecodeRemoteStorageDocument(raw []byte) (RemoteStorageDocument, error) {
	var document RemoteStorageDocument
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&document); err != nil {
		return RemoteStorageDocument{}, fmt.Errorf("decode remote storage config: %w", err)
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return RemoteStorageDocument{}, errors.New("remote storage config must contain exactly one JSON document")
	}
	if document.Version != 1 {
		return RemoteStorageDocument{}, errors.New("remote storage config version must be 1")
	}
	if document.Instances == nil {
		document.Instances = []RemoteStorageInstanceConfig{}
	}
	if err := validateRemoteInstances(document.Instances); err != nil {
		return RemoteStorageDocument{}, err
	}
	return document, nil
}

// SaveRemoteStorageDocument atomically persists a validated, secret-free configuration.
func SaveRemoteStorageDocument(cfg RemoteStorageConfig, document RemoteStorageDocument) error {
	if strings.TrimSpace(cfg.ConfigFile) == "" {
		return errors.New("remote storage config file is not configured")
	}
	if document.Version != 1 {
		return errors.New("remote storage config version must be 1")
	}
	if document.Instances == nil {
		document.Instances = []RemoteStorageInstanceConfig{}
	}
	if err := validateRemoteInstances(document.Instances); err != nil {
		return err
	}
	dir := filepath.Dir(cfg.ConfigFile)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("create remote storage config directory: %w", err)
	}
	temporary, err := os.CreateTemp(dir, ".remote-storage-*.json")
	if err != nil {
		return fmt.Errorf("create temporary remote storage config: %w", err)
	}
	temporaryName := temporary.Name()
	defer os.Remove(temporaryName)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return fmt.Errorf("secure temporary remote storage config: %w", err)
	}
	encoder := json.NewEncoder(temporary)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(document); err != nil {
		temporary.Close()
		return fmt.Errorf("encode remote storage config: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return fmt.Errorf("sync remote storage config: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close remote storage config: %w", err)
	}
	if err := os.Rename(temporaryName, cfg.ConfigFile); err != nil {
		return fmt.Errorf("replace remote storage config: %w", err)
	}
	return nil
}

func validateRemoteInstances(instances []RemoteStorageInstanceConfig) error {
	if len(instances) > 64 {
		return errors.New("remote storage supports at most 64 instances")
	}
	seen := make(map[string]struct{}, len(instances))
	for index, instance := range instances {
		if !instanceIDPattern.MatchString(instance.ID) {
			return fmt.Errorf("remote storage instance %d has invalid id", index+1)
		}
		if _, exists := seen[instance.ID]; exists {
			return fmt.Errorf("duplicate remote storage instance id %q", instance.ID)
		}
		seen[instance.ID] = struct{}{}
		provider := strings.ToLower(strings.TrimSpace(instance.Provider))
		if !supportedRemoteStorageProvider(provider) {
			return fmt.Errorf("remote storage instance %q has unsupported provider", instance.ID)
		}
		if instance.Priority < 0 {
			return fmt.Errorf("remote storage instance %q priority cannot be negative", instance.ID)
		}
		if instance.Limits.MaxRequests < 0 || instance.Limits.WindowSeconds < 0 || instance.Limits.MaxFiles < 0 || instance.Limits.MaxFileBytes < 0 || instance.Limits.MaxInputBytes < 0 || instance.Limits.MaxStoredObjects < 0 || instance.Limits.MaxStorageBytes < 0 {
			return fmt.Errorf("remote storage instance %q limits cannot be negative", instance.ID)
		}
		if instance.Limits.MaxRequests > 1_000_000_000 || instance.Limits.WindowSeconds > 31_536_000 || instance.Limits.MaxFiles > 1024 || instance.Limits.MaxStoredObjects > 10_000_000 || instance.Limits.MaxFileBytes > 1<<50 || instance.Limits.MaxInputBytes > 1<<50 || instance.Limits.MaxStorageBytes > 1<<50 {
			return fmt.Errorf("remote storage instance %q limit exceeds supported range", instance.ID)
		}
		if instance.Limits.MaxRequests > 0 && instance.Limits.WindowSeconds <= 0 {
			return fmt.Errorf("remote storage instance %q requires window_seconds when max_requests is set", instance.ID)
		}
		if instance.AuthorizationEnv != "" && !envNamePattern.MatchString(instance.AuthorizationEnv) {
			return fmt.Errorf("remote storage instance %q has invalid authorization_env", instance.ID)
		}
		if provider == "trycloudflare" {
			continue
		}
		legacyHTTP := provider == "http" || (provider == "webdav" && strings.TrimSpace(instance.RcloneRemote) == "")
		if legacyHTTP {
			if err := validateStorageURL(instance.UploadURL, false); err != nil {
				return fmt.Errorf("remote storage instance %q upload_url %w", instance.ID, err)
			}
			if err := validateStorageURL(instance.PublicURL, true); err != nil {
				return fmt.Errorf("remote storage instance %q public_url %w", instance.ID, err)
			}
		}
		if providerUsesRclone(provider) && !legacyHTTP {
			remote := strings.TrimSpace(instance.RcloneRemote)
			if remote == "" || strings.ContainsAny(remote, "/\\\x00\r\n") || strings.HasPrefix(remote, "-") {
				return fmt.Errorf("remote storage instance %q has invalid rclone_remote", instance.ID)
			}
			if instance.PublicURL != "" {
				if err := validateStorageURL(instance.PublicURL, true); err != nil {
					return fmt.Errorf("remote storage instance %q public_url %w", instance.ID, err)
				}
			}
			if (provider == "s3" || provider == "webdav" || provider == "nextcloud") && instance.PublicURL == "" {
				return fmt.Errorf("remote storage instance %q requires public_url for provider %s", instance.ID, provider)
			}
		}
	}
	return nil
}

func supportedRemoteStorageProvider(provider string) bool {
	switch provider {
	case "http", "rclone", "drive", "dropbox", "onedrive", "s3", "webdav", "nextcloud", "box", "pcloud", "trycloudflare":
		return true
	default:
		return false
	}
}

func providerUsesRclone(provider string) bool {
	return provider != "http" && provider != "trycloudflare" && supportedRemoteStorageProvider(provider)
}

func validateStorageURL(raw string, public bool) error {
	value, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || value.Host == "" || (value.Scheme != "https" && value.Scheme != "http") {
		return errors.New("must be an absolute HTTP(S) URL")
	}
	if value.User != nil || value.RawQuery != "" || value.Fragment != "" {
		return errors.New("must not contain userinfo, query, or fragment")
	}
	if public && value.Scheme != "https" {
		return errors.New("must use HTTPS")
	}
	return nil
}

func hydrateRemoteSecrets(instances []RemoteStorageInstanceConfig) ([]RemoteStorageInstanceConfig, error) {
	for index := range instances {
		if instances[index].AuthorizationEnv == "" {
			continue
		}
		value := os.Getenv(instances[index].AuthorizationEnv)
		if value == "" {
			return nil, fmt.Errorf("remote storage instance %q requires environment secret %s", instances[index].ID, instances[index].AuthorizationEnv)
		}
		instances[index].Authorization = value
	}
	return instances, nil
}

func remoteConfigFile(stateFile string) string {
	if stateFile == "" {
		return ""
	}
	return filepath.Join(filepath.Dir(stateFile), "remote-storage.json")
}

func remoteIndexFile(stateFile string) string {
	if stateFile == "" {
		return ""
	}
	return filepath.Join(filepath.Dir(stateFile), "remote-inputs.json")
}

func tunnelConfigFile(stateFile string) string {
	if stateFile == "" {
		return ""
	}
	return filepath.Join(filepath.Dir(stateFile), "tunnel-providers.json")
}

func tunnelIndexFile(stateFile string) string {
	if stateFile == "" {
		return ""
	}
	return filepath.Join(filepath.Dir(stateFile), "tunnel-inputs.json")
}

func defaultStateFile() string {
	dir, err := os.UserConfigDir()
	if err != nil || dir == "" {
		return ""
	}
	return dir + "/wharness/sessions.json"
}

func env(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func envInt64(key string, fallback int64) int64 {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}

func envBool(key string, fallback bool) bool {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func ReadArtifactSettings(cfg ArtifactStorageConfig) (ArtifactSettingsDocument, error) {
	defaults := ArtifactSettingsDocument{Version: 1, RetentionDays: 30, BundleWindowLimit: 80}
	raw, err := os.ReadFile(cfg.SettingsFile)
	if errors.Is(err, os.ErrNotExist) {
		return defaults, nil
	}
	if err != nil {
		return ArtifactSettingsDocument{}, fmt.Errorf("read artifact settings: %w", err)
	}
	var document ArtifactSettingsDocument
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&document); err != nil {
		return ArtifactSettingsDocument{}, fmt.Errorf("decode artifact settings: %w", err)
	}
	if document.BundleWindowLimit == 0 {
		document.BundleWindowLimit = 80
	}
	if err := validateArtifactSettings(document); err != nil {
		return ArtifactSettingsDocument{}, err
	}
	return document, nil
}

func validateArtifactSettings(document ArtifactSettingsDocument) error {
	if document.Version != 1 || document.RetentionDays < 1 || document.RetentionDays > 3650 {
		return errors.New("artifact settings require version 1 and retention_days between 1 and 3650")
	}
	if document.BundleWindowLimit < 1 || document.BundleWindowLimit > 10000 {
		return errors.New("artifact settings require bundle_window_limit between 1 and 10000")
	}
	return nil
}

func SaveArtifactSettings(cfg ArtifactStorageConfig, document ArtifactSettingsDocument) error {
	if err := validateArtifactSettings(document); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(cfg.SettingsFile), 0o700); err != nil {
		return fmt.Errorf("create artifact settings directory: %w", err)
	}
	tmp, err := os.CreateTemp(filepath.Dir(cfg.SettingsFile), ".artifact-storage-*.json")
	if err != nil {
		return err
	}
	name := tmp.Name()
	defer os.Remove(name)
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		return err
	}
	encoder := json.NewEncoder(tmp)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(document); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(name, cfg.SettingsFile)
}
