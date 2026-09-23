package tunneldaemon

import (
	"errors"
	"net/http"
	"strings"
)

const (
	APIPathHealth       = "/health"
	APIPathStatus       = "/v1/status"
	APIPathProviders    = "/v1/providers"
	APIPathEnroll       = "/v1/providers/enroll"
	APIPathDisconnect   = "/v1/providers/disconnect"
	APIPathPublish      = "/v1/objects"
	APIPathRetain       = "/v1/objects/retain"
	APIPathRelease      = "/v1/objects/release"
	APIPathChannels     = "/v1/channels"
	APIPathChannelSet   = "/v1/channels/set"
	APIPathChannel      = "/v1/channels/item"
	APIPathReload       = "/v1/config/reload"
	APIPathSessionStart = "/v1/session/start"
	APIPathSessionClear = "/v1/session/clear"
	APIPathCleanup      = "/v1/cleanup"
)

type instanceObjectRequest struct {
	InstanceID string `json:"instance_id"`
	ObjectName string `json:"object_name"`
}

type instanceChannelRequest struct {
	InstanceID string `json:"instance_id"`
	ChannelID  string `json:"channel_id"`
}

type closeChannelSetRequest struct {
	InstanceIDs []string `json:"instance_ids"`
	ChannelID   string   `json:"channel_id"`
}

type cleanupRequest struct {
	Cutoff string `json:"cutoff"`
}

func authorize(token string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if token == "" || r.Header.Get("Authorization") != "Bearer "+token {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func validateBaseURL(raw string) (string, error) {
	value := strings.TrimRight(strings.TrimSpace(raw), "/")
	if value == "" || !(strings.HasPrefix(value, "http://tunnel:") || strings.HasPrefix(value, "http://127.0.0.1:")) {
		return "", errors.New("tunnel daemon URL must be an internal HTTP origin")
	}
	return value, nil
}
