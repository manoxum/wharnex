package app

import (
	"fmt"
	"path/filepath"
	"regexp"
	"strings"

	"kernl.local/harness/backend/internal/domain"
)

const chatExportReadme = `# Wharnex chat audit export

Schema: wharness.chat-export/v1

This archive is a user-requested diagnostic export of one Harness chat. It contains:

- the local transcript and GPT responses correlated to request ids when available;
- backend operational events plus the frontend cached event history;
- execution results with argv, stdout, stderr, exit codes, success and errors retained by Wharnex;
- Policy/approval/blocking events and the current Policy decision;
- request lineage (main request, repair/correction, conflict/evidence derivatives);
- every persisted chat artifact, including the original request/response ZIP bytes.

Persisted artifact bytes are copied unchanged. Operational event fields keep the normal Wharnex audit redaction rules. The export does not read ChatGPT cookies, browser storage, or unrelated conversations.
`

func renderChatTranscript(title string, items []map[string]any) string {
	var out strings.Builder
	out.WriteString("# ")
	if strings.TrimSpace(title) == "" {
		out.WriteString("Harness chat")
	} else {
		out.WriteString(title)
	}
	out.WriteString("\n\n")
	for _, item := range items {
		source := stringField(item, "source")
		if source == "" {
			source = stringField(item, "role")
		}
		label := map[string]string{"user": "User", "chatgpt": "ChatGPT", "wharness": "Wharnex", "harness": "Wharnex"}[source]
		if label == "" {
			label = source
		}
		requestID := requestIDFromItem(item)
		out.WriteString("## ")
		out.WriteString(label)
		if created := stringField(item, "createdAt"); created != "" {
			out.WriteString(" · ")
			out.WriteString(created)
		}
		if requestID != "" {
			out.WriteString(" · `")
			out.WriteString(requestID)
			out.WriteString("`")
		}
		out.WriteString("\n\n")
		out.WriteString(stringField(item, "text"))
		out.WriteString("\n\n")
	}
	return out.String()
}

func extractGPTResponses(items []map[string]any) []gptExportResponse {
	responses := make([]gptExportResponse, 0)
	lastRequestID := ""
	for _, item := range items {
		if requestID := requestIDFromItem(item); requestID != "" {
			lastRequestID = requestID
		}
		if stringField(item, "source") != "chatgpt" {
			continue
		}
		requestID := requestIDFromItem(item)
		if requestID == "" {
			requestID = lastRequestID
		}
		responses = append(responses, gptExportResponse{
			ItemID: stringField(item, "id"), RequestID: requestID,
			CreatedAt: stringField(item, "createdAt"), TurnKind: stringField(item, "turnKind"), Text: stringField(item, "text"),
		})
	}
	return responses
}

func requestIDFromItem(item map[string]any) string {
	iteration, ok := item["iteration"].(map[string]any)
	if !ok {
		return ""
	}
	if value, ok := iteration["requestId"].(string); ok {
		return value
	}
	return ""
}

func stringField(item map[string]any, key string) string {
	value, _ := item[key].(string)
	return value
}

func executionEvents(events []domain.Event) []domain.Event {
	selected := make([]domain.Event, 0)
	for _, event := range events {
		kind := strings.ToLower(event.Type)
		if containsAny(kind, "execution.", "command.", "terminal.command_", "verification", "patch.", "host.apply", "apply.") {
			selected = append(selected, event)
		}
	}
	return selected
}

func securityEvents(events []domain.Event) []domain.Event {
	selected := make([]domain.Event, 0)
	for _, event := range events {
		kind := strings.ToLower(event.Type)
		if containsAny(kind, "policy", "approval", "approved", "blocked", "permission", "network", "mode_changed", "pending_rejected", "request.cancelled") {
			selected = append(selected, event)
		}
	}
	return selected
}

func containsAny(value string, needles ...string) bool {
	for _, needle := range needles {
		if strings.Contains(value, needle) {
			return true
		}
	}
	return false
}

func artifactLineage(item domain.Session, record domain.ArtifactRecord) string {
	if lineage, ok := item.RequestLineages[record.RequestID]; ok && lineage.Kind != "" {
		return lineage.Kind
	}
	return "standard"
}

func artifactExportPath(record domain.ArtifactRecord, lineage string) string {
	name := safeExportSegment(record.ID) + "__" + safeExportSegment(filepath.Base(record.Name))
	if record.Bundle {
		phase := safeExportSegment(lineage)
		switch phase {
		case "standard", "":
			phase = "main"
		case "repair":
			phase = "correction"
		}
		side := "request"
		if record.Direction == "output" {
			side = "response"
		}
		return fmt.Sprintf("bundles/%s/%s/%s", phase, side, name)
	}
	return fmt.Sprintf("artifacts/%s/%s/%s", safeExportSegment(record.Direction), safeExportSegment(record.Kind), name)
}

var unsafeExportSegment = regexp.MustCompile(`[^A-Za-z0-9._-]+`)

func safeExportSegment(value string) string {
	value = strings.Trim(unsafeExportSegment.ReplaceAllString(strings.TrimSpace(value), "_"), "._-")
	if len(value) > 180 {
		value = value[:180]
	}
	return value
}
