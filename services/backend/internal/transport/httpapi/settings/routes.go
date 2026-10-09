package settings

import (
	"net/http"
	"time"

	"kernl.local/harness/backend/internal/app"
	"kernl.local/harness/backend/internal/config"
)

// Routes owns the persisted Desktop settings HTTP surface.
type Routes struct {
	service *app.Service
	cfg     config.Config
}

func New(service *app.Service, cfg config.Config) *Routes {
	return &Routes{service: service, cfg: cfg}
}

func (a *Routes) ArtifactSettings(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, a.service.ArtifactSettings())
}

func (a *Routes) UpdateArtifactSettings(w http.ResponseWriter, r *http.Request) {
	var body struct {
		RetentionDays           int   `json:"retention_days"`
		BundleWindowLimit       int   `json:"bundle_window_limit"`
		AttachmentCountLimit    int   `json:"attachment_count_limit"`
		RequestBundleTotalBytes int64 `json:"request_bundle_total_bytes"`
		RequestBundlePartBytes  int64 `json:"request_bundle_part_bytes"`
		RequestBundlePartLimit  int   `json:"request_bundle_part_limit"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	current := a.service.ArtifactSettings()
	if body.BundleWindowLimit < 1 {
		body.BundleWindowLimit = current.BundleWindowLimit
	}
	if body.RequestBundleTotalBytes < 1 {
		body.RequestBundleTotalBytes = current.RequestBundleTotalBytes
	}
	if body.RequestBundlePartBytes < 1 {
		body.RequestBundlePartBytes = current.RequestBundlePartBytes
	}
	if body.RequestBundlePartLimit < 1 {
		body.RequestBundlePartLimit = current.RequestBundlePartLimit
	}
	document := config.ArtifactSettingsDocument{
		Version: 1, RetentionDays: body.RetentionDays, BundleWindowLimit: body.BundleWindowLimit,
		AttachmentCountLimit: body.AttachmentCountLimit, RequestBundleTotalBytes: body.RequestBundleTotalBytes,
		RequestBundlePartBytes: body.RequestBundlePartBytes, RequestBundlePartLimit: body.RequestBundlePartLimit,
	}
	if err := config.SaveArtifactSettings(a.cfg.Artifacts, document); err != nil {
		writeError(w, http.StatusBadRequest, "artifact_settings_invalid", err.Error())
		return
	}
	a.service.SetArtifactRetentionDays(body.RetentionDays)
	a.service.SetBundleWindowLimit(body.BundleWindowLimit)
	a.service.SetChatInputLimits(body.AttachmentCountLimit, body.RequestBundleTotalBytes, body.RequestBundlePartBytes, body.RequestBundlePartLimit)
	before := time.Now().UTC().Add(-time.Duration(body.RetentionDays) * 24 * time.Hour)
	if err := a.service.CleanupArtifacts(r.Context(), before); err != nil {
		writeError(w, http.StatusInternalServerError, "artifact_cleanup_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, a.service.ArtifactSettings())
}

func (a *Routes) LanguageSettings(w http.ResponseWriter, _ *http.Request) {
	document, err := config.ReadLanguageSettings(a.cfg.LanguageSettingsFile)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "language_settings_read_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, document)
}

func (a *Routes) UpdateLanguageSettings(w http.ResponseWriter, r *http.Request) {
	var document config.LanguageSettingsDocument
	if !decodeJSON(w, r, &document) {
		return
	}
	if err := config.SaveLanguageSettings(a.cfg.LanguageSettingsFile, document); err != nil {
		writeError(w, http.StatusBadRequest, "language_settings_invalid", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, document)
}

func (a *Routes) UIPreferences(w http.ResponseWriter, _ *http.Request) {
	document, err := config.ReadUIPreferences(a.cfg.UIPreferencesFile)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "ui_preferences_read_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, document)
}

func (a *Routes) UpdateUIPreferences(w http.ResponseWriter, r *http.Request) {
	var document config.UIPreferencesDocument
	if !decodeJSON(w, r, &document) {
		return
	}
	if err := config.SaveUIPreferences(a.cfg.UIPreferencesFile, document); err != nil {
		writeError(w, http.StatusBadRequest, "ui_preferences_invalid", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, document)
}

func (a *Routes) BundleQuota(w http.ResponseWriter, r *http.Request) {
	quota, err := a.service.BundleQuotaSnapshot(r.Context(), time.Now().UTC())
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "bundle_quota_unavailable", "Não foi possível consultar as estatísticas de bundles.")
		return
	}
	writeJSON(w, http.StatusOK, quota)
}
