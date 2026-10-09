// Package bundleusage projects bundle transport evidence without inspecting payloads.
package bundleusage

import (
	"sort"
	"time"

	"kernl.local/harness/backend/internal/oplog"
)

type Counts struct {
	Type              string `json:"type"`
	Sent              int    `json:"sent"`
	Received          int    `json:"received"`
	Total             int    `json:"total"`
	EstimatedReceived int    `json:"estimated_received"`
}

type Task struct {
	ID, Type, RequestID, Source string
}

const deliveryCorrelationWindow = time.Minute

func Summarize(records []oplog.Record, tasks []Task, start, end time.Time) []Counts {
	byID, byRequest := taskCatalog(tasks)
	seen := map[string]bool{}
	var transfers []transfer
	for _, record := range records {
		if record.OccurredAt.Before(start.Add(-deliveryCorrelationWindow)) || record.OccurredAt.After(end) || (record.ID != "" && seen[record.ID]) {
			continue
		}
		seen[record.ID] = true
		if item, ok := classify(record); ok {
			if task, found := byID[item.taskID]; found {
				item.kind = task.Type
			} else if task, found := byRequest[item.requestID]; found {
				item.kind = task.Type
			}
			transfers = append(transfers, item)
		}
	}
	counts := map[string]*Counts{}
	for _, item := range transfers {
		// A download just before the window may explain a later local delivery,
		// but its bytes must not count in the current transport window.
		if item.at.Before(start) || (item.estimated && hasCompletedDownload(item, transfers)) {
			continue
		}
		row := counts[item.kind]
		if row == nil {
			row = &Counts{Type: item.kind}
			counts[item.kind] = row
		}
		if item.sent {
			row.Sent++
		} else {
			row.Received++
			if item.estimated {
				row.EstimatedReceived++
			}
		}
		row.Total++
	}
	result := make([]Counts, 0, len(counts))
	for _, row := range counts {
		result = append(result, *row)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Type < result[j].Type })
	return result
}

func taskCatalog(tasks []Task) (map[string]Task, map[string]Task) {
	byID, byRequest := map[string]Task{}, map[string]Task{}
	for _, task := range tasks {
		if task.Source == "orchestrator" && task.Type == "ORCHESTRATOR_TASK" {
			task.Type = "ORCHESTRATOR_EXECUTE"
		}
		byID[task.ID] = task
		// Request ownership is defined by the sending task, not response observation.
		if task.RequestID != "" && (task.Type == "BOT_WRITE" || task.Type == "RECOVERY_WRITE" || task.Type == "ORCHESTRATOR_EXECUTE") {
			byRequest[task.RequestID] = task
		}
	}
	return byID, byRequest
}

func hasCompletedDownload(delivery transfer, items []transfer) bool {
	for _, item := range items {
		if item.sent || item.estimated || item.at.After(delivery.at) || delivery.at.Sub(item.at) > deliveryCorrelationWindow {
			continue
		}
		if delivery.filename != "" {
			if item.filename == delivery.filename {
				return true
			}
			continue
		}
		if delivery.taskID != "" && item.taskID == delivery.taskID && delivery.family == item.family {
			return true
		}
	}
	return false
}
