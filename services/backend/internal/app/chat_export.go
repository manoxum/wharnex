package app

import (
	"archive/zip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"sort"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/domain"
)

const ChatExportSchema = "wharness.chat-export/v1"

type ChatExportInput struct {
	ChatID         string           `json:"chat_id"`
	Title          string           `json:"title"`
	ChatGPTURL     string           `json:"chatgpt_url,omitempty"`
	ChatItems      []map[string]any `json:"chat_items"`
	FrontendEvents []domain.Event   `json:"frontend_events"`
}

type ChatExportSummary struct {
	Filename   string
	Generated  time.Time
	EntryCount int
}

type exportArtifact struct {
	domain.ArtifactRecord
	ExportPath string `json:"export_path"`
	Lineage    string `json:"lineage"`
}

type gptExportResponse struct {
	ItemID    string `json:"item_id,omitempty"`
	RequestID string `json:"request_id,omitempty"`
	CreatedAt string `json:"created_at,omitempty"`
	TurnKind  string `json:"turn_kind,omitempty"`
	Text      string `json:"text"`
}

func (s *Service) WriteChatExport(ctx context.Context, sessionID string, input ChatExportInput, dst io.Writer) (ChatExportSummary, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return ChatExportSummary{}, err
	}
	if strings.TrimSpace(input.ChatID) == "" {
		input.ChatID = item.ChatID
	}
	if item.ChatID != "" && input.ChatID != item.ChatID {
		return ChatExportSummary{}, fmt.Errorf("chat export id %q does not match session chat %q", input.ChatID, item.ChatID)
	}

	generated := time.Now().UTC()
	backendEvents := s.bus.History(sessionID)
	artifactIndex := make([]exportArtifact, 0, len(item.Artifacts))
	zw := zip.NewWriter(dst)
	entries := 0
	add := func(name string, raw []byte) error {
		writer, createErr := zw.CreateHeader(&zip.FileHeader{Name: name, Method: zip.Deflate})
		if createErr != nil {
			return createErr
		}
		if _, writeErr := writer.Write(raw); writeErr != nil {
			return writeErr
		}
		entries++
		return nil
	}
	addJSON := func(name string, value any) error {
		raw, marshalErr := json.MarshalIndent(value, "", "  ")
		if marshalErr != nil {
			return marshalErr
		}
		return add(name, append(raw, '\n'))
	}

	manifest := map[string]any{
		"schema": ChatExportSchema, "generated_at": generated, "session_id": item.ID,
		"chat_id": input.ChatID, "title": input.Title, "project_path": item.ProjectPath,
		"backend_event_count": len(backendEvents), "frontend_event_count": len(input.FrontendEvents),
		"chat_item_count": len(input.ChatItems), "artifact_count": len(item.Artifacts),
	}
	if input.ChatGPTURL != "" {
		manifest["chatgpt_url"] = input.ChatGPTURL
	}
	if err := addJSON("manifest.json", manifest); err != nil {
		return ChatExportSummary{}, err
	}
	if err := add("README.md", []byte(chatExportReadme)); err != nil {
		return ChatExportSummary{}, err
	}
	if err := addJSON("chat/transcript.json", input.ChatItems); err != nil {
		return ChatExportSummary{}, err
	}
	if err := add("chat/transcript.md", []byte(renderChatTranscript(input.Title, input.ChatItems))); err != nil {
		return ChatExportSummary{}, err
	}
	if err := addJSON("chat/gpt-responses-by-request.json", extractGPTResponses(input.ChatItems)); err != nil {
		return ChatExportSummary{}, err
	}
	if err := addJSON("session/session.json", item); err != nil {
		return ChatExportSummary{}, err
	}
	if err := addJSON("events/backend-events.json", backendEvents); err != nil {
		return ChatExportSummary{}, err
	}
	if err := addJSON("events/frontend-cached-events.json", input.FrontendEvents); err != nil {
		return ChatExportSummary{}, err
	}
	if err := writeExecutionExport(addJSON, item, backendEvents); err != nil {
		return ChatExportSummary{}, err
	}
	if err := addJSON("security/policy-and-permissions.json", map[string]any{
		"current_policy": item.Policy, "events": securityEvents(backendEvents),
	}); err != nil {
		return ChatExportSummary{}, err
	}
	if err := addJSON("planner/request-lineages.json", item.RequestLineages); err != nil {
		return ChatExportSummary{}, err
	}
	if item.Plan != nil {
		if err := addJSON("planner/current-plan.json", item.Plan); err != nil {
			return ChatExportSummary{}, err
		}
	}
	if item.LastTurn != nil {
		if err := addJSON("planner/last-turn.json", item.LastTurn); err != nil {
			return ChatExportSummary{}, err
		}
	}
	if item.LastManualPrompt != "" {
		if err := add("planner/last-manual-prompt.md", []byte(item.LastManualPrompt+"\n")); err != nil {
			return ChatExportSummary{}, err
		}
	}

	artifacts := append([]domain.ArtifactRecord(nil), item.Artifacts...)
	sort.Slice(artifacts, func(i, j int) bool { return artifacts[i].CreatedAt.Before(artifacts[j].CreatedAt) })
	for _, record := range artifacts {
		_, raw, readErr := s.ReadArtifact(ctx, sessionID, record.ID)
		if readErr != nil {
			return ChatExportSummary{}, fmt.Errorf("read artifact %s for chat export: %w", record.ID, readErr)
		}
		lineage := artifactLineage(item, record)
		exportPath := artifactExportPath(record, lineage)
		if err := add(exportPath, raw); err != nil {
			return ChatExportSummary{}, err
		}
		artifactIndex = append(artifactIndex, exportArtifact{ArtifactRecord: record, ExportPath: exportPath, Lineage: lineage})
	}
	if err := addJSON("artifacts/index.json", artifactIndex); err != nil {
		return ChatExportSummary{}, err
	}
	if err := zw.Close(); err != nil {
		return ChatExportSummary{}, err
	}
	chat := safeExportSegment(input.ChatID)
	if chat == "" {
		chat = "unknown"
	}
	return ChatExportSummary{Filename: fmt.Sprintf("wharness-chat-%s-%s.zip", chat, generated.Format("20060102T150405Z")), Generated: generated, EntryCount: entries}, nil
}

func writeExecutionExport(addJSON func(string, any) error, item domain.Session, events []domain.Event) error {
	if err := addJSON("execution/operational-events.json", executionEvents(events)); err != nil {
		return err
	}
	if item.LastExecution != nil {
		if err := addJSON("execution/last-execution.json", item.LastExecution); err != nil {
			return err
		}
	}
	if err := addJSON("execution/pending-host-changes.json", item.PendingHostChanges); err != nil {
		return err
	}
	return addJSON("execution/last-applied-changes.json", item.LastAppliedChanges)
}
