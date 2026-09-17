package openai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/planner"
)

type Client struct {
	apiKey  string
	model   string
	baseURL string
	http    *http.Client
	mu      sync.Mutex
	files   map[string]string
}

func New(apiKey, model, baseURL string) *Client {
	return &Client{
		apiKey: apiKey, model: model, baseURL: strings.TrimRight(baseURL, "/"),
		http: &http.Client{Timeout: 20 * time.Minute}, files: make(map[string]string),
	}
}

func (c *Client) Plan(ctx context.Context, request planner.Request) (planner.Result, error) {
	if request.PlanningMode == "orchestrator" {
		return c.planOrchestrator(ctx, request)
	}
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
		"reasoning":    map[string]any{"effort": apiReasoningEffort(request.ReasoningEffort)},
		"instructions": planner.SystemProtocol + planner.ProviderTurnContract,
		"text":         map[string]any{"format": executionFormat(request.RequestID, request.ContextManifest.SHA256)},
		"store":        true,
		"truncation":   "auto",
		"input": []any{map[string]any{
			"role": "user",
			"content": []any{
				map[string]any{"type": "input_file", "file_id": fileID},
				map[string]any{"type": "input_text", "text": "REQUEST ID: " + request.RequestID + "\nAUTOMATION MODE: " + string(request.AutomationMode) + "\nEFFORT LEVEL: " + string(request.EffortLevel) + "\nSELF-EVOLUTION MODE: " + fmt.Sprintf("%t", request.SelfEvolution) + "\nUSER REQUEST OR WHARNEX CONTINUATION:\n" + request.Message},
			},
		}},
	}
	if request.PreviousResponseID != "" {
		body["previous_response_id"] = request.PreviousResponseID
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
		return planner.Result{}, fmt.Errorf("openai responses request: %w", err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return planner.Result{}, fmt.Errorf("openai responses status %d: %s", resp.StatusCode, sanitizeProviderError(data))
	}
	var decoded responsePayload
	if err := json.Unmarshal(data, &decoded); err != nil {
		return planner.Result{}, fmt.Errorf("decode provider response: %w", err)
	}
	text := decoded.OutputText
	if text == "" {
		text = collectOutputText(decoded.Output)
	}
	if text == "" {
		return planner.Result{}, errors.New("provider returned no structured output text")
	}
	var wire struct {
		Protocol  string                `json:"protocol"`
		RequestID string                `json:"request_id"`
		Kind      domain.TurnKind       `json:"kind"`
		ChatTitle string                `json:"chat_title"`
		Message   string                `json:"message"`
		Outcome   *domain.TurnOutcome   `json:"outcome"`
		Plan      *domain.ExecutionPlan `json:"plan"`
	}
	decoder := json.NewDecoder(strings.NewReader(text))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&wire); err != nil {
		return planner.Result{}, fmt.Errorf("decode agent turn: %w", err)
	}
	turn := domain.AgentTurn{Protocol: wire.Protocol, RequestID: wire.RequestID, Kind: wire.Kind, ChatTitle: wire.ChatTitle, Message: wire.Message, Outcome: wire.Outcome}
	return planner.Result{Plan: wire.Plan, Turn: &turn, ProviderResponseID: decoded.ID}, nil
}

func apiReasoningEffort(effort domain.ReasoningEffort) string {
	switch effort {
	case domain.ReasoningEffortInstant:
		return "none"
	case domain.ReasoningEffortMedium:
		return "medium"
	default:
		return "high"
	}
}

func (c *Client) contextFileID(ctx context.Context, path, cacheKey string) (string, error) {
	c.mu.Lock()
	if id := c.files[cacheKey]; id != "" {
		c.mu.Unlock()
		return id, nil
	}
	c.mu.Unlock()

	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	_ = mw.WriteField("purpose", "user_data")
	part, err := mw.CreateFormFile("file", filepath.Base(path))
	if err != nil {
		return "", err
	}
	if _, err := io.Copy(part, file); err != nil {
		return "", err
	}
	_ = mw.Close()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/files", &body)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	resp, err := c.http.Do(req)
	if err != nil {
		return "", fmt.Errorf("upload context: %w", err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("upload context status %d: %s", resp.StatusCode, sanitizeProviderError(data))
	}
	var uploaded struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(data, &uploaded); err != nil || uploaded.ID == "" {
		return "", errors.New("provider returned invalid file id")
	}
	c.mu.Lock()
	c.files[cacheKey] = uploaded.ID
	c.mu.Unlock()
	return uploaded.ID, nil
}

type responsePayload struct {
	ID         string `json:"id"`
	OutputText string `json:"output_text"`
	Output     []struct {
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
	} `json:"output"`
}

func collectOutputText(items []struct {
	Content []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	} `json:"content"`
}) string {
	var out strings.Builder
	for _, item := range items {
		for _, content := range item.Content {
			if content.Type == "output_text" {
				out.WriteString(content.Text)
			}
		}
	}
	return out.String()
}

func sanitizeProviderError(data []byte) string {
	s := string(data)
	if len(s) > 800 {
		s = s[:800] + "…"
	}
	return strings.ReplaceAll(s, "\n", " ")
}

func executionFormat(requestID, baselineSHA256 string) map[string]any {
	plan := executionPlanSchema(requestID, baselineSHA256)
	schema := map[string]any{
		"type": "object", "additionalProperties": false,
		"required": []string{"protocol", "request_id", "kind", "chat_title", "message", "outcome", "interview", "plan"},
		"properties": map[string]any{
			"protocol":   map[string]any{"type": "string", "const": domain.TurnProtocolV1},
			"request_id": map[string]any{"type": "string", "const": requestID},
			"kind":       map[string]any{"type": "string", "enum": []string{"answer", "clarification", "investigation", "plan", "workflow", "change", "blocked"}},
			"chat_title": map[string]any{"type": "string", "minLength": 2, "maxLength": 82},
			"message":    map[string]any{"type": "string"},
			"outcome": map[string]any{
				"type": "object", "additionalProperties": false,
				"required": []string{"status", "reason_code", "message", "retryable"},
				"properties": map[string]any{
					"status":      map[string]any{"type": "string", "enum": []string{domain.TurnOutcomeCompleted, domain.TurnOutcomeFailed, domain.TurnOutcomePartial}},
					"reason_code": map[string]any{"type": "string"},
					"message":     map[string]any{"type": "string"},
					"retryable":   map[string]any{"type": "boolean"},
				},
			},
			"interview": map[string]any{"anyOf": []any{
				map[string]any{"type": "null"},
				map[string]any{"type": "object", "additionalProperties": false, "required": []string{"protocol", "questions"}, "properties": map[string]any{
					"protocol": map[string]any{"const": domain.InterviewProtocolV1},
					"questions": map[string]any{"type": "array", "items": map[string]any{"type": "object", "additionalProperties": false, "required": []string{"id", "prompt", "options"}, "properties": map[string]any{
						"id": map[string]any{"type": "string"}, "prompt": map[string]any{"type": "string"}, "allow_multiple": map[string]any{"type": "boolean"},
						"options": map[string]any{"type": "array", "items": map[string]any{"type": "object", "additionalProperties": false, "required": []string{"id", "label"}, "properties": map[string]any{"id": map[string]any{"type": "string"}, "label": map[string]any{"type": "string"}}}},
					}}},
				}},
			}},
			"plan": map[string]any{"anyOf": []any{plan, map[string]any{"type": "null"}}},
		},
	}
	return map[string]any{"type": "json_schema", "name": "wharness_agent_turn", "strict": true, "schema": schema}
}

func executionPlanSchema(requestID, baselineSHA256 string) map[string]any {
	command := map[string]any{
		"type": "object", "additionalProperties": false,
		"required": []string{"argv", "cwd", "timeout_seconds", "network", "expected_exit_codes"},
		"properties": map[string]any{
			"argv":                map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
			"cwd":                 map[string]any{"type": "string"},
			"timeout_seconds":     map[string]any{"type": "integer", "minimum": 1, "maximum": 1800},
			"network":             map[string]any{"type": "boolean"},
			"expected_exit_codes": map[string]any{"type": "array", "items": map[string]any{"type": "integer"}},
		},
	}
	versionIncrement := map[string]any{
		"type": "object", "additionalProperties": false,
		"required": []string{"component", "amount"},
		"properties": map[string]any{
			"component": map[string]any{"type": "string", "enum": []string{domain.VersionComponentMajor, domain.VersionComponentMedium, domain.VersionComponentMinor, domain.VersionComponentPatch}},
			"amount":    map[string]any{"type": "integer", "minimum": 1, "maximum": 1000},
		},
	}
	operation := map[string]any{
		"type": "object", "additionalProperties": false,
		"required": []string{"type", "patch", "command"},
		"properties": map[string]any{
			"type":    map[string]any{"type": "string", "enum": []string{"apply_patch", "command"}},
			"patch":   map[string]any{"type": "string"},
			"command": command,
		},
	}
	schema := map[string]any{
		"type": "object", "additionalProperties": false,
		"required": []string{"protocol", "base_context_sha256", "impact_files", "read_files", "barrier_files", "plan_id", "request_id", "status", "summary", "risk", "requires_approval", "operations", "verification"},
		"properties": map[string]any{
			"protocol":            map[string]any{"type": "string", "const": domain.ProtocolV1},
			"base_context_sha256": map[string]any{"type": "string", "const": baselineSHA256},
			"impact_files":        map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "maxItems": 256},
			"read_files":          map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "maxItems": 256},
			"barrier_files":       map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "maxItems": 64},
			"plan_id":             map[string]any{"type": "string"},
			"request_id":          map[string]any{"type": "string", "const": requestID},
			"status":              map[string]any{"type": "string", "enum": []string{"ready", "blocked"}},
			"summary":             map[string]any{"type": "string"},
			"version_increment":   versionIncrement,
			"risk":                map[string]any{"type": "string", "enum": []string{"low", "medium", "high"}},
			"requires_approval":   map[string]any{"type": "boolean"},
			"operations":          map[string]any{"type": "array", "items": operation},
			"verification":        map[string]any{"type": "array", "items": command},
		},
	}
	return schema
}
