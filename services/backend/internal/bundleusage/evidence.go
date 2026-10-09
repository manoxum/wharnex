package bundleusage

import (
	"fmt"
	"regexp"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/bundlename"
	"kernl.local/harness/backend/internal/oplog"
)

var taskPattern = regexp.MustCompile(`cat_[a-f0-9]{20}`)
var requestPattern = regexp.MustCompile(`req_[0-9]{8}T[0-9]{6}_[a-f0-9]{16}`)

type transfer struct {
	taskID, requestID, kind, filename, family string
	at                                        time.Time
	sent, estimated                           bool
}

// Historical delivery evidence is restricted to bundle-bearing routes.
var deliveryRoutes = []string{
	"POST /api/ui-testing/tasks/{id}/step/result",
	"POST /api/ui-testing/tasks/{id}/guide/result",
	"POST /api/ui-testing/tasks/{id}/discovery",
}

func field(record oplog.Record, key string) string {
	if value, ok := record.Data[key]; ok {
		return fmt.Sprint(value)
	}
	return ""
}

func classify(record oplog.Record) (transfer, bool) {
	item := transfer{at: record.OccurredAt, kind: "UNATTRIBUTED", filename: field(record, "name")}
	if item.filename == "" {
		item.filename = field(record, "file")
	}
	item.taskID = taskPattern.FindString(record.TaskID)
	if item.taskID == "" {
		for _, value := range []string{field(record, "task"), record.TraceID, item.filename, field(record, "path")} {
			if item.taskID = taskPattern.FindString(value); item.taskID != "" {
				break
			}
		}
	}
	item.requestID = requestPattern.FindString(record.RequestID)
	parsed, parsedOK := bundlename.Parse(item.filename)
	if !parsedOK {
		parsed, parsedOK = bundlename.ParseWithDuplicateSuffix(item.filename)
	}
	if parsedOK {
		item.requestID = parsed.RequestID
		if parsed.SubrequestID != "" {
			item.requestID = parsed.SubrequestID
		}
		item.kind = "AGENT_REQUEST"
		if parsed.ChatID == "orchestrator" {
			item.kind = "ORCHESTRATOR_PLAN"
		} else if item.taskID == "" {
			// Execution bundles use the durable Orchestrator task as chat id.
			// Ordinary chat ids simply find no task in the catalog.
			item.taskID = parsed.ChatID
		}
	}
	if item.requestID == "" {
		item.requestID = requestPattern.FindString(record.TraceID)
	}
	if item.requestID != "" && item.kind == "UNATTRIBUTED" {
		item.kind = "AGENT_REQUEST"
	}
	for prefix, kind := range map[string]string{
		"whx_ui_test_step_": "UI_TEST_RUN", "whx_ui_test_guide_": "UI_TEST_RUN",
		"whx_ui_test_discovery_": "UI_TEST_DISCOVER", "whx_translation_": "TRANSLATE_MARKDOWN",
		"whx_todo_classification_": "TODO_CLASSIFY",
		"whx_release_notes_":       "RELEASE_NOTES",
	} {
		if strings.HasPrefix(item.filename, prefix) {
			item.kind = kind
		}
	}
	item.family = family(item.filename)
	switch {
	case record.Source == "desktop" && record.Component == "chatgpt-upload":
		item.sent = true
		return item, strings.HasPrefix(record.Message, "confirmed ") && field(record, "observed") == "true"
	case record.Source == "desktop" && record.Component == "chatgpt-bundle-received":
		return item, item.filename != ""
	case record.Source == "desktop" && record.Component == "chatgpt-bundle-download":
		item.estimated = true
		return item, strings.HasPrefix(record.Message, "awaiting-ack file=") && item.filename != ""
	case record.Source == "backend" && record.Component == "http":
		status := field(record, "status")
		if status != "200" && status != "400" {
			return item, false
		}
		for _, route := range deliveryRoutes {
			if field(record, "route") != route || item.taskID == "" {
				continue
			}
			item.estimated = true
			item.kind, item.family = "UI_TEST_RUN", "step"
			if strings.HasSuffix(route, "/guide/result") {
				item.family = "guide"
			} else if strings.HasSuffix(route, "/discovery") {
				item.kind, item.family = "UI_TEST_DISCOVER", "discovery"
			}
			return item, true
		}
	}
	return item, false
}

func family(filename string) string {
	for _, value := range []string{"step", "guide", "discovery"} {
		if strings.HasPrefix(filename, "whx_ui_test_"+value+"_") {
			return value
		}
	}
	return "bundle"
}
