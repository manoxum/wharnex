package httpapi

import "kernl.local/harness/backend/internal/uitesting"

type discoveryTaskPayload struct {
	Protocol      string                               `json:"protocol"`
	Request       uitesting.DiscoveryTransportManifest `json:"request"`
	Bootstrap     string                               `json:"bootstrap"`
	ArchiveBase64 string                               `json:"archive_base64"`
}
