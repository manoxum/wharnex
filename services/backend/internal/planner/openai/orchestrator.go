package openai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"kernl.local/harness/backend/internal/orchestrator"
	"kernl.local/harness/backend/internal/planner"
)

func (c *Client) planOrchestrator(ctx context.Context, request planner.Request) (planner.Result, error) {
	contextKey := request.ContextManifest.SHA256
	if contextKey == "" {
		contextKey = request.ContextTextPath
	}
	fileID, err := c.contextFileID(ctx, request.ContextTextPath, contextKey)
	if err != nil {
		return planner.Result{}, err
	}
	body := map[string]any{
		"model":        c.model,
		"instructions": planner.OrchestratorSystemPrompt,
		"text":         map[string]any{"format": orchestratorFormat()},
		"store":        false,
		"truncation":   "auto",
		"input": []any{map[string]any{
			"role": "user",
			"content": []any{
				map[string]any{"type": "input_file", "file_id": fileID},
				map[string]any{"type": "input_text", "text": "OBJECTIVE:\n" + request.Message},
			},
		}},
	}
	payload, _ := json.Marshal(body)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/responses", bytes.NewReader(payload))
	if err != nil {
		return planner.Result{}, err
	}
	httpReq.Header.Set("Authorization", "Bearer "+c.apiKey)
	httpReq.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(httpReq)
	if err != nil {
		return planner.Result{}, fmt.Errorf("openai orchestrator request: %w", err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return planner.Result{}, fmt.Errorf("openai orchestrator status %d: %s", resp.StatusCode, sanitizeProviderError(data))
	}
	var decoded responsePayload
	if err := json.Unmarshal(data, &decoded); err != nil {
		return planner.Result{}, fmt.Errorf("decode orchestrator provider response: %w", err)
	}
	text := decoded.OutputText
	if text == "" {
		text = collectOutputText(decoded.Output)
	}
	if text == "" {
		return planner.Result{}, errors.New("provider returned no orchestrator proposal")
	}
	var proposal orchestrator.Proposal
	decoder := json.NewDecoder(strings.NewReader(text))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&proposal); err != nil {
		return planner.Result{}, fmt.Errorf("decode orchestrator proposal: %w", err)
	}
	if err := orchestrator.ValidateProposal(proposal); err != nil {
		return planner.Result{}, err
	}
	return planner.Result{OrchestratorPlan: &proposal, ProviderResponseID: decoded.ID}, nil
}

func orchestratorFormat() map[string]any {
	stringArray := map[string]any{"type": "array", "items": map[string]any{"type": "string"}}
	task := map[string]any{
		"type": "object", "additionalProperties": false,
		"required": []string{"id", "title", "description", "acceptance_criteria", "depends_on", "priority", "capability", "complexity", "parallelizable", "impact_files", "read_files", "barrier_files"},
		"properties": map[string]any{
			"id":                  map[string]any{"type": "string"},
			"title":               map[string]any{"type": "string"},
			"description":         map[string]any{"type": "string"},
			"acceptance_criteria": stringArray,
			"depends_on":          stringArray,
			"priority":            map[string]any{"type": "string", "enum": []string{"low", "normal", "high", "urgent"}},
			"capability":          map[string]any{"type": "string"},
			"complexity":          map[string]any{"type": "string", "enum": []string{"low", "medium", "high"}},
			"parallelizable":      map[string]any{"type": "boolean"},
			"impact_files":        stringArray,
			"read_files":          stringArray,
			"barrier_files":       stringArray,
		},
	}
	schema := map[string]any{
		"type": "object", "additionalProperties": false,
		"required": []string{"protocol", "title", "objective", "assumptions", "tasks"},
		"properties": map[string]any{
			"protocol":    map[string]any{"type": "string", "const": orchestrator.ProtocolV1},
			"title":       map[string]any{"type": "string"},
			"objective":   map[string]any{"type": "string"},
			"assumptions": stringArray,
			"tasks":       map[string]any{"type": "array", "minItems": 1, "maxItems": 128, "items": task},
		},
	}
	return map[string]any{"type": "json_schema", "name": "wharnex_orchestrator_plan", "strict": true, "schema": schema}
}
