package app

import (
	"encoding/json"
	"fmt"
	"strings"

	"kernl.local/harness/backend/internal/domain"
)

const (
	legacyRelatedContextRoot    = "RELATED_PROJECTS/"
	legacyAttachmentContextRoot = "ATTACHMENTS/"
	legacyContextSourcesIndex   = "RELATED_PROJECTS.json"

	requestPrimaryContextRoot   = "context/"
	requestReferenceContextRoot = "ref-context/"
	requestAttachedContextRoot  = "att-context/"
	requestContextMapRoot       = "context-map/"
	requestContextSourcesIndex  = "metadata/context-sources.json"
)

type requestContextSourcesDocument struct {
	Protocol    string                         `json:"protocol"`
	Primary     string                         `json:"primary_project"`
	Projects    []domain.RelatedProjectContext `json:"related_projects"`
	Attachments []domain.AttachedPathContext   `json:"attached_paths,omitempty"`
	Rule        string                         `json:"execution_rule"`
}

func requestArchiveRelatedPrefix(prefix string) string {
	clean := strings.Trim(strings.TrimSpace(prefix), "/")
	clean = strings.TrimPrefix(clean, strings.TrimSuffix(legacyRelatedContextRoot, "/"))
	clean = strings.Trim(clean, "/")
	if clean == "" {
		return requestReferenceContextRoot
	}
	return requestReferenceContextRoot + clean + "/"
}

func requestArchiveAttachmentPrefix(prefix string) string {
	clean := strings.Trim(strings.TrimSpace(prefix), "/")
	clean = strings.TrimPrefix(clean, strings.TrimSuffix(legacyAttachmentContextRoot, "/"))
	clean = strings.Trim(clean, "/")
	segment := strings.SplitN(clean, "/", 2)[0]
	if dash := strings.IndexByte(segment, '-'); dash > 0 {
		segment = segment[:dash]
	}
	if segment == "" {
		segment = "01"
	}
	return requestAttachedContextRoot + "attach-" + segment + "/"
}

func requestArchiveContextEntry(clean string, workspace bool) string {
	if !workspace {
		return requestPrimaryContextRoot + clean
	}
	if clean == legacyContextSourcesIndex {
		return requestContextSourcesIndex
	}
	if strings.HasPrefix(clean, legacyRelatedContextRoot) {
		return requestReferenceContextRoot + strings.TrimPrefix(clean, legacyRelatedContextRoot)
	}
	if strings.HasPrefix(clean, legacyAttachmentContextRoot) {
		relative := strings.TrimPrefix(clean, legacyAttachmentContextRoot)
		parts := strings.SplitN(relative, "/", 2)
		prefix := requestArchiveAttachmentPrefix(legacyAttachmentContextRoot + parts[0] + "/")
		if len(parts) == 1 {
			return strings.TrimSuffix(prefix, "/")
		}
		return prefix + parts[1]
	}
	return requestPrimaryContextRoot + clean
}

func rewriteRequestContextSources(raw []byte) ([]byte, error) {
	var document requestContextSourcesDocument
	if err := json.Unmarshal(raw, &document); err != nil {
		return nil, fmt.Errorf("decode legacy context sources index: %w", err)
	}
	document.Protocol = "harness.context-sources/v1"
	for index := range document.Projects {
		document.Projects[index].Prefix = requestArchiveRelatedPrefix(document.Projects[index].Prefix)
	}
	for index := range document.Attachments {
		document.Attachments[index].Prefix = requestArchiveAttachmentPrefix(document.Attachments[index].Prefix)
	}
	document.Rule = "context/ contains only the primary project snapshot. ref-context/ contains related project snapshots whose write authority is controlled by the request grant. att-context/ contains read-only external @attach material and is never a patch target. context-map/ contains generated path inventory, deterministic semantic guidance with byte/round budget metadata, and redacted sensitive configuration key-state metadata; semantic ranking is advisory and context-map/ is never a patch target."
	encoded, err := json.MarshalIndent(document, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("encode context sources index: %w", err)
	}
	return append(encoded, '\n'), nil
}
