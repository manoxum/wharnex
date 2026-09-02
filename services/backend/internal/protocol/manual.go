package protocol

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"kernl.local/harness/backend/internal/domain"
)

type manualPlanEnvelope struct {
	Protocol         string            `json:"protocol"`
	Schema           string            `json:"schema"`
	PlanID           string            `json:"plan_id"`
	RequestID        string            `json:"request_id"`
	Status           string            `json:"status"`
	Summary          string            `json:"summary"`
	Risk             string            `json:"risk"`
	RequiresApproval bool              `json:"requires_approval"`
	Operations       []manualOperation `json:"operations"`
	Verification     []json.RawMessage `json:"verification"`
}

type manualOperation struct {
	Type    string        `json:"type"`
	Cwd     string        `json:"cwd"`
	Patch   string        `json:"patch"`
	Command manualCommand `json:"command"`
}

type manualCommand struct {
	Argv              []string `json:"argv"`
	Cwd               string   `json:"cwd"`
	TimeoutSeconds    int      `json:"timeout_seconds"`
	Network           bool     `json:"network"`
	ExpectedExitCodes []int    `json:"expected_exit_codes"`
}

// NormalizeManualPlan accepts the strict v1 wire format plus a deliberately
// small set of common ChatGPT mistakes. Normalization never relaxes policy:
// the returned plan is still passed through Validate and the policy engine.
func NormalizeManualPlan(raw []byte, activeRequestID string) (domain.ExecutionPlan, error) {
	prepared, err := prepareManualJSON(raw)
	if err != nil {
		return domain.ExecutionPlan{}, err
	}
	var input manualPlanEnvelope
	if err := json.Unmarshal(prepared, &input); err != nil {
		return domain.ExecutionPlan{}, fmt.Errorf("invalid JSON execution plan: %w", err)
	}
	protocol := strings.TrimSpace(input.Protocol)
	if protocol == "" && strings.TrimSpace(input.Schema) == domain.ProtocolV1 {
		protocol = domain.ProtocolV1
	}
	requestID := strings.TrimSpace(input.RequestID)
	if requestID == "" {
		requestID = activeRequestID
	}
	planID := strings.TrimSpace(input.PlanID)
	if planID == "" && requestID != "" {
		planID = "manual-" + requestID
	}
	status := strings.TrimSpace(input.Status)
	if status == "" {
		status = "ready"
	}
	risk := strings.TrimSpace(input.Risk)
	if risk == "" {
		if len(input.Operations) > 0 {
			risk = "medium"
		} else {
			risk = "low"
		}
	}

	plan := domain.ExecutionPlan{
		Protocol:         protocol,
		PlanID:           planID,
		RequestID:        requestID,
		Status:           status,
		Summary:          input.Summary,
		Risk:             risk,
		RequiresApproval: input.RequiresApproval,
		Operations:       make([]domain.Operation, 0, len(input.Operations)),
		Verification:     make([]domain.CommandSpec, 0, len(input.Verification)),
	}
	for i, op := range input.Operations {
		normalized := domain.Operation{Type: op.Type, Patch: op.Patch, Command: normalizeCommand(op.Command, op.Cwd)}
		if normalized.Type == "apply_patch" {
			normalized.Command.Argv = []string{}
			if strings.HasPrefix(strings.TrimSpace(normalized.Patch), "*** Begin Patch") {
				converted, err := convertBeginPatch(normalized.Patch)
				if err != nil {
					return domain.ExecutionPlan{}, fmt.Errorf("operation %d patch normalization: %w", i, err)
				}
				normalized.Patch = converted
			}
		}
		plan.Operations = append(plan.Operations, normalized)
	}
	for i, rawCommand := range input.Verification {
		command, err := normalizeVerification(rawCommand)
		if err != nil {
			return domain.ExecutionPlan{}, fmt.Errorf("verification %d: %w", i, err)
		}
		plan.Verification = append(plan.Verification, command)
	}
	return plan, nil
}

var (
	patchCommandBoundary = regexp.MustCompile(`"\s*,\s*"command"\s*:`)
	summaryFieldBoundary = regexp.MustCompile(`"\s*,\s*"(?:risk|requires_approval|operations)"\s*:`)
)

// prepareManualJSON keeps the strict execution-plan validator authoritative, but
// repairs one narrow transport failure commonly produced by chat UIs: an
// otherwise valid JSON plan whose patch string contains unescaped double quotes
// from source code (for example CSS: content: "";). Only the patch value is
// repaired, only when it clearly starts with a supported patch dialect, and only
// when the following field is the operation command object.
func prepareManualJSON(raw []byte) ([]byte, error) {
	candidate := stripMarkdownFence(bytes.TrimSpace(raw))
	if json.Valid(candidate) {
		return candidate, nil
	}
	repaired := append([]byte(nil), candidate...)
	changed := false

	var repairedField bool
	repaired, repairedField, err := repairLooseStringField(repaired, "summary", summaryFieldBoundary, nil)
	if err != nil {
		return nil, err
	}
	changed = changed || repairedField

	repaired, repairedField, err = repairMalformedPatchStrings(repaired)
	if err != nil {
		return nil, err
	}
	changed = changed || repairedField
	if changed && json.Valid(repaired) {
		return repaired, nil
	}
	var syntaxErr *json.SyntaxError
	if err := json.Unmarshal(candidate, &map[string]any{}); err != nil {
		if errors.As(err, &syntaxErr) {
			return nil, fmt.Errorf("invalid JSON execution plan near byte %d; ensure double quotes inside summary/patch strings are JSON-escaped as \\\"", syntaxErr.Offset)
		}
		return nil, fmt.Errorf("invalid JSON execution plan: %w", err)
	}
	return candidate, nil
}

func stripMarkdownFence(raw []byte) []byte {
	trimmed := bytes.TrimSpace(raw)
	if !bytes.HasPrefix(trimmed, []byte("```")) {
		return trimmed
	}
	firstNewline := bytes.IndexByte(trimmed, '\n')
	if firstNewline < 0 {
		return trimmed
	}
	body := bytes.TrimSpace(trimmed[firstNewline+1:])
	if bytes.HasSuffix(body, []byte("```")) {
		body = bytes.TrimSpace(body[:len(body)-3])
	}
	return body
}

// repairLooseStringField repairs a single known JSON string field whose value
// contains unescaped source/text quotes. The boundary is a fixed structural key
// that follows the value in the v1 wire contract. This is transport repair only:
// the resulting JSON is still decoded, validated and evaluated by policy.
func repairLooseStringField(raw []byte, field string, boundary *regexp.Regexp, acceptedPrefixes [][]byte) ([]byte, bool, error) {
	key := []byte(`"` + field + `"`)
	keyPos := bytes.Index(raw, key)
	if keyPos < 0 {
		return raw, false, nil
	}
	colonRel := bytes.IndexByte(raw[keyPos+len(key):], ':')
	if colonRel < 0 {
		return raw, false, nil
	}
	colon := keyPos + len(key) + colonRel
	valueStart := colon + 1
	for valueStart < len(raw) && (raw[valueStart] == ' ' || raw[valueStart] == '\t' || raw[valueStart] == '\r' || raw[valueStart] == '\n') {
		valueStart++
	}
	if valueStart >= len(raw) || raw[valueStart] != '"' {
		return raw, false, nil
	}
	contentStart := valueStart + 1
	if len(acceptedPrefixes) > 0 {
		accepted := false
		for _, prefix := range acceptedPrefixes {
			if bytes.HasPrefix(raw[contentStart:], prefix) {
				accepted = true
				break
			}
		}
		if !accepted {
			return raw, false, nil
		}
	}
	boundaryMatch := boundary.FindIndex(raw[contentStart:])
	if boundaryMatch == nil {
		return raw, false, nil
	}
	closingQuote := contentStart + boundaryMatch[0]
	fragment := raw[contentStart:closingQuote]
	decoded, err := decodeLooseJSONStringFragment(fragment)
	if err != nil {
		return nil, false, fmt.Errorf("invalid JSON %s string: %w", field, err)
	}
	encoded, _ := json.Marshal(decoded)
	replacement := make([]byte, 0, len(raw)-len(fragment)+len(encoded))
	replacement = append(replacement, raw[:valueStart]...)
	replacement = append(replacement, encoded...)
	replacement = append(replacement, raw[closingQuote+1:]...)
	return replacement, true, nil
}

func repairMalformedPatchStrings(raw []byte) ([]byte, bool, error) {
	const key = `"patch"`
	out := append([]byte(nil), raw...)
	changed := false
	searchFrom := 0
	for {
		relKey := bytes.Index(out[searchFrom:], []byte(key))
		if relKey < 0 {
			break
		}
		keyPos := searchFrom + relKey
		colon := bytes.IndexByte(out[keyPos+len(key):], ':')
		if colon < 0 {
			break
		}
		colon += keyPos + len(key)
		valueStart := colon + 1
		for valueStart < len(out) && (out[valueStart] == ' ' || out[valueStart] == '\t' || out[valueStart] == '\r' || out[valueStart] == '\n') {
			valueStart++
		}
		if valueStart >= len(out) || out[valueStart] != '"' {
			searchFrom = valueStart
			continue
		}
		contentStart := valueStart + 1
		if contentStart >= len(out) || !(bytes.HasPrefix(out[contentStart:], []byte("diff --git ")) || bytes.HasPrefix(out[contentStart:], []byte("*** Begin Patch"))) {
			searchFrom = contentStart
			continue
		}
		boundary := patchCommandBoundary.FindIndex(out[contentStart:])
		if boundary == nil {
			return nil, false, errors.New("invalid JSON patch string: could not locate the following command field")
		}
		closingQuote := contentStart + boundary[0]
		fragment := out[contentStart:closingQuote]
		decoded, err := decodeLooseJSONStringFragment(fragment)
		if err != nil {
			return nil, false, fmt.Errorf("invalid JSON patch string: %w", err)
		}
		encoded, _ := json.Marshal(decoded)
		replacement := make([]byte, 0, len(out)-len(fragment)+len(encoded))
		replacement = append(replacement, out[:valueStart]...)
		replacement = append(replacement, encoded...)
		replacement = append(replacement, out[closingQuote+1:]...)
		out = replacement
		changed = true
		searchFrom = valueStart + len(encoded)
	}
	return out, changed, nil
}

func decodeLooseJSONStringFragment(fragment []byte) (string, error) {
	// Preserve valid JSON escapes already produced by the model, while escaping
	// only raw quotes that source code introduced inside the patch string.
	escaped := make([]byte, 0, len(fragment)+16)
	for i, b := range fragment {
		if b == '"' && !isEscapedAt(fragment, i) {
			escaped = append(escaped, '\\')
		}
		escaped = append(escaped, b)
	}
	wrapped := append([]byte{'"'}, escaped...)
	wrapped = append(wrapped, '"')
	var decoded string
	if err := json.Unmarshal(wrapped, &decoded); err != nil {
		return "", err
	}
	return decoded, nil
}

func isEscapedAt(data []byte, index int) bool {
	backslashes := 0
	for i := index - 1; i >= 0 && data[i] == '\\'; i-- {
		backslashes++
	}
	return backslashes%2 == 1
}

func normalizeVerification(raw json.RawMessage) (domain.CommandSpec, error) {
	var direct manualCommand
	if err := json.Unmarshal(raw, &direct); err != nil {
		return domain.CommandSpec{}, err
	}
	if len(direct.Argv) > 0 {
		return normalizeCommand(direct, direct.Cwd), nil
	}
	var wrapped manualOperation
	if err := json.Unmarshal(raw, &wrapped); err != nil {
		return domain.CommandSpec{}, err
	}
	if len(wrapped.Command.Argv) == 0 {
		return domain.CommandSpec{}, errors.New("command argv is required")
	}
	return normalizeCommand(wrapped.Command, wrapped.Cwd), nil
}

func normalizeCommand(command manualCommand, fallbackCwd string) domain.CommandSpec {
	cwd := strings.TrimSpace(command.Cwd)
	if cwd == "" {
		cwd = strings.TrimSpace(fallbackCwd)
	}
	if cwd == "" {
		cwd = "."
	}
	timeout := command.TimeoutSeconds
	if timeout == 0 {
		timeout = 60
	}
	expected := command.ExpectedExitCodes
	if len(expected) == 0 {
		expected = []int{0}
	}
	return domain.CommandSpec{
		Argv:              command.Argv,
		Cwd:               cwd,
		TimeoutSeconds:    timeout,
		Network:           command.Network,
		ExpectedExitCodes: expected,
	}
}

// convertBeginPatch only accepts the simple "Add File" form. Update/Delete
// variants are intentionally rejected because translating them without full
// diff context can silently change semantics.
func convertBeginPatch(patch string) (string, error) {
	normalized := strings.ReplaceAll(patch, "\r\n", "\n")
	lines := strings.Split(normalized, "\n")
	if len(lines) < 4 || strings.TrimSpace(lines[0]) != "*** Begin Patch" {
		return "", errors.New("unsupported patch dialect")
	}
	index := 1
	var output strings.Builder
	converted := 0
	for index < len(lines) {
		line := strings.TrimSpace(lines[index])
		if line == "" {
			index++
			continue
		}
		if line == "*** End Patch" {
			break
		}
		const addPrefix = "*** Add File:"
		if !strings.HasPrefix(line, addPrefix) {
			return "", fmt.Errorf("unsupported patch directive %q; ask ChatGPT for a standard unified diff", line)
		}
		filePath := strings.TrimSpace(strings.TrimPrefix(line, addPrefix))
		if err := validatePatchPath(filePath); err != nil {
			return "", err
		}
		index++
		var content []string
		for index < len(lines) {
			candidate := lines[index]
			trimmed := strings.TrimSpace(candidate)
			if trimmed == "*** End Patch" || strings.HasPrefix(trimmed, "*** Add File:") || strings.HasPrefix(trimmed, "*** Update File:") || strings.HasPrefix(trimmed, "*** Delete File:") {
				break
			}
			if !strings.HasPrefix(candidate, "+") {
				return "", fmt.Errorf("Add File line must start with '+': %q", candidate)
			}
			content = append(content, strings.TrimPrefix(candidate, "+"))
			index++
		}
		output.WriteString("diff --git a/")
		output.WriteString(filePath)
		output.WriteString(" b/")
		output.WriteString(filePath)
		output.WriteString("\nnew file mode 100644\n--- /dev/null\n+++ b/")
		output.WriteString(filePath)
		output.WriteString("\n@@ -0,0 +1,")
		output.WriteString(strconv.Itoa(len(content)))
		output.WriteString(" @@\n")
		for _, contentLine := range content {
			output.WriteString("+")
			output.WriteString(contentLine)
			output.WriteString("\n")
		}
		converted++
	}
	if converted == 0 {
		return "", errors.New("patch contains no supported Add File operation")
	}
	return output.String(), nil
}
