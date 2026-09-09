package app

import (
	"strings"
	"time"

	"kernl.local/harness/backend/internal/bundlename"
	"kernl.local/harness/backend/internal/domain"
)

const (
	defaultBundleWindowLimit = 80
	maxBundleWindowLimit     = 10000
	bundleQuotaWindow        = 3 * time.Hour
)

type BundleQuota struct {
	WindowHours int       `json:"window_hours"`
	Limit       int       `json:"limit"`
	Sent        int       `json:"sent"`
	Received    int       `json:"received"`
	Total       int       `json:"total"`
	Warning     bool      `json:"warning"`
	WindowStart time.Time `json:"window_start"`
	WindowEnd   time.Time `json:"window_end"`
}

func (s *Service) SetBundleWindowLimit(limit int) {
	if limit < 1 {
		limit = defaultBundleWindowLimit
	}
	if limit > maxBundleWindowLimit {
		limit = maxBundleWindowLimit
	}
	s.bundleWindowLimit.Store(int64(limit))
}

func (s *Service) BundleWindowLimit() int {
	limit := int(s.bundleWindowLimit.Load())
	if limit < 1 {
		return defaultBundleWindowLimit
	}
	return limit
}

func (s *Service) BundleQuota(now time.Time) BundleQuota {
	windowEnd := now.UTC()
	windowStart := windowEnd.Add(-bundleQuotaWindow)
	quota := BundleQuota{
		WindowHours: 3,
		Limit:       s.BundleWindowLimit(),
		WindowStart: windowStart,
		WindowEnd:   windowEnd,
	}
	for _, item := range s.store.List() {
		for _, artifact := range item.Artifacts {
			if artifact.CreatedAt.Before(windowStart) || artifact.CreatedAt.After(windowEnd) || !isQuotaTransportBundle(artifact) {
				continue
			}
			if artifact.Direction == "input" {
				quota.Sent++
			} else {
				quota.Received++
			}
		}
	}
	quota.Total = quota.Sent + quota.Received
	quota.Warning = quota.Sent >= quota.Limit
	return quota
}

func isQuotaTransportBundle(artifact domain.ArtifactRecord) bool {
	if artifact.Kind != "bundle" || !artifact.Bundle || strings.TrimSpace(artifact.RequestID) == "" {
		return false
	}
	parsed, ok := bundlename.Parse(artifact.Name)
	if !ok {
		parsed, ok = bundlename.ParseWithDuplicateSuffix(artifact.Name)
	}
	if !ok {
		return false
	}
	expectedDirection := "input"
	if parsed.Kind == bundlename.KindResponse {
		expectedDirection = "output"
	}
	effectiveRequestID := parsed.RequestID
	if parsed.SubrequestID != "" {
		effectiveRequestID = parsed.SubrequestID
	}
	return artifact.Direction == expectedDirection && artifact.RequestID == effectiveRequestID
}
