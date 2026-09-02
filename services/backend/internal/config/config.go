package config

import (
	"os"
	"strconv"
)

type Config struct {
	Addr              string
	Planner           string
	Sandbox           string
	RunnerImage       string
	OpenAIAPIKey      string
	OpenAIModel       string
	OpenAIBaseURL     string
	MaxContextBytes   int64
	MaxBundleBytes    int64
	AllowLocalSandbox bool
}

func Load() Config {
	return Config{
		Addr:              env("HARNESS_ADDR", "127.0.0.1:8080"),
		Planner:           env("HARNESS_PLANNER", "manual"),
		Sandbox:           env("HARNESS_SANDBOX", "docker"),
		RunnerImage:       env("HARNESS_RUNNER_IMAGE", "kernl-runner:local"),
		OpenAIAPIKey:      os.Getenv("OPENAI_API_KEY"),
		OpenAIModel:       env("OPENAI_MODEL", "gpt-5.6-sol"),
		OpenAIBaseURL:     env("OPENAI_BASE_URL", "https://api.openai.com/v1"),
		MaxContextBytes:   envInt64("HARNESS_MAX_CONTEXT_BYTES", 4*1024*1024),
		MaxBundleBytes:    envInt64("HARNESS_MAX_BUNDLE_BYTES", 128*1024*1024),
		AllowLocalSandbox: envBool("HARNESS_ALLOW_LOCAL_SANDBOX", false),
	}
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
