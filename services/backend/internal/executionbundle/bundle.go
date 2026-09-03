package executionbundle

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"path"
	"sort"
	"strings"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/protocol"
)

const (
	MaxBundleBytes   = 16 << 20
	maxExpandedBytes = 32 << 20
	maxEntries       = 128
)

type operationWire struct {
	Type      string             `json:"type"`
	Patch     string             `json:"patch,omitempty"`
	PatchFile string             `json:"patch_file,omitempty"`
	Command   domain.CommandSpec `json:"command"`
}

type planWire struct {
	Protocol         string               `json:"protocol"`
	PlanID           string               `json:"plan_id"`
	RequestID        string               `json:"request_id"`
	Status           string               `json:"status"`
	Summary          string               `json:"summary"`
	Risk             string               `json:"risk"`
	RequiresApproval bool                 `json:"requires_approval"`
	Operations       []operationWire      `json:"operations"`
	Verification     []domain.CommandSpec `json:"verification"`
}

type Parsed struct {
	Plan *domain.ExecutionPlan
	Turn domain.AgentTurn
	Info domain.ExecutionBundleInfo
}

type turnWire struct {
	Protocol  string          `json:"protocol"`
	RequestID string          `json:"request_id"`
	Kind      domain.TurnKind `json:"kind"`
	Message   string          `json:"message"`
}

func Parse(filename string, raw []byte) (Parsed, error) {
	if len(raw) == 0 || len(raw) > MaxBundleBytes {
		return Parsed{}, fmt.Errorf("execution bundle size must be between 1 byte and %d bytes", MaxBundleBytes)
	}
	reader, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		return Parsed{}, fmt.Errorf("open execution bundle zip: %w", err)
	}
	if len(reader.File) == 0 || len(reader.File) > maxEntries {
		return Parsed{}, fmt.Errorf("execution bundle must contain 1..%d entries", maxEntries)
	}

	files := make(map[string][]byte, len(reader.File))
	var expanded int64
	for _, entry := range reader.File {
		isDir := entry.FileInfo().IsDir()
		candidate := entry.Name
		if isDir {
			candidate = strings.TrimSuffix(candidate, "/")
		}
		name, err := safeName(candidate)
		if err != nil {
			return Parsed{}, err
		}
		if entry.FileInfo().Mode()&0o170000 == 0o120000 {
			return Parsed{}, fmt.Errorf("bundle symlink is forbidden: %s", name)
		}
		if isDir {
			continue
		}
		expanded += int64(entry.UncompressedSize64)
		if expanded > maxExpandedBytes {
			return Parsed{}, fmt.Errorf("execution bundle expanded size exceeds %d bytes", maxExpandedBytes)
		}
		rc, err := entry.Open()
		if err != nil {
			return Parsed{}, fmt.Errorf("open bundle entry %s: %w", name, err)
		}
		data, readErr := io.ReadAll(io.LimitReader(rc, maxExpandedBytes+1))
		_ = rc.Close()
		if readErr != nil {
			return Parsed{}, fmt.Errorf("read bundle entry %s: %w", name, readErr)
		}
		if _, duplicate := files[name]; duplicate {
			return Parsed{}, fmt.Errorf("duplicate bundle entry: %s", name)
		}
		files[name] = data
	}

	readmeBytes, ok := files["README.md"]
	if !ok || len(bytes.TrimSpace(readmeBytes)) == 0 {
		return Parsed{}, errors.New("execution bundle requires non-empty README.md")
	}
	if len(readmeBytes) > 1<<20 {
		return Parsed{}, errors.New("README.md exceeds 1 MiB limit")
	}
	turn, hasTurn, err := parseTurn(files["turn.json"])
	if err != nil {
		return Parsed{}, err
	}
	planBytes, hasPlan := files["plan.json"]
	if !hasTurn && !hasPlan {
		return Parsed{}, errors.New("execution bundle requires turn.json or plan.json")
	}
	if hasTurn && turn.Kind == domain.TurnKindChange && !hasPlan {
		return Parsed{}, errors.New("change turn requires plan.json")
	}
	if hasTurn && turn.Kind != domain.TurnKindChange && hasPlan {
		return Parsed{}, errors.New("only change turns may contain plan.json")
	}
	var plan *domain.ExecutionPlan
	patches := make([]string, 0)
	if hasPlan {
		if len(planBytes) > 2<<20 {
			return Parsed{}, errors.New("plan.json exceeds 2 MiB limit")
		}
		var wire planWire
		decoder := json.NewDecoder(bytes.NewReader(planBytes))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&wire); err != nil {
			return Parsed{}, fmt.Errorf("decode plan.json: %w", err)
		}
		resolvedPlan := domain.ExecutionPlan{
			Protocol: wire.Protocol, PlanID: wire.PlanID, RequestID: wire.RequestID,
			Status: wire.Status, Summary: wire.Summary, Risk: wire.Risk,
			RequiresApproval: wire.RequiresApproval, Operations: make([]domain.Operation, 0), Verification: wire.Verification,
		}
		if resolvedPlan.Verification == nil {
			resolvedPlan.Verification = make([]domain.CommandSpec, 0)
		}
		for index, op := range wire.Operations {
			resolved := domain.Operation{Type: op.Type, Patch: op.Patch, Command: op.Command}
			if op.Type == "apply_patch" && op.PatchFile != "" {
				if strings.TrimSpace(op.Patch) != "" {
					return Parsed{}, fmt.Errorf("operation %d cannot contain both patch and patch_file", index)
				}
				patchName, patchErr := safePatchName(op.PatchFile)
				if patchErr != nil {
					return Parsed{}, fmt.Errorf("operation %d: %w", index, patchErr)
				}
				patchBytes, exists := files[patchName]
				if !exists {
					return Parsed{}, fmt.Errorf("operation %d references missing %s", index, patchName)
				}
				resolved.Patch = string(patchBytes)
				patches = append(patches, patchName)
			}
			resolvedPlan.Operations = append(resolvedPlan.Operations, resolved)
		}
		plan = &resolvedPlan
		if !hasTurn {
			turn = domain.AgentTurn{Protocol: domain.TurnProtocolV1, RequestID: plan.RequestID, Kind: domain.TurnKindChange, Message: plan.Summary}
		}
		if turn.RequestID != plan.RequestID {
			return Parsed{}, errors.New("turn.json/plan.json request_id mismatch")
		}
	}

	listed := make([]string, 0, len(files))
	for name := range files {
		listed = append(listed, name)
	}
	sort.Strings(listed)
	sort.Strings(patches)
	digest := sha256.Sum256(raw)
	return Parsed{Plan: plan, Info: domain.ExecutionBundleInfo{
		Filename: path.Base(filename), README: string(readmeBytes), Files: listed,
		Patches: patches, SHA256: hex.EncodeToString(digest[:]),
	}, Turn: turn}, nil
}

func parseTurn(raw []byte) (domain.AgentTurn, bool, error) {
	if raw == nil {
		return domain.AgentTurn{}, false, nil
	}
	if len(raw) > 512<<10 {
		return domain.AgentTurn{}, false, errors.New("turn.json exceeds 512 KiB limit")
	}
	var wire turnWire
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&wire); err != nil {
		return domain.AgentTurn{}, false, fmt.Errorf("decode turn.json: %w", err)
	}
	turn := domain.AgentTurn{Protocol: wire.Protocol, RequestID: wire.RequestID, Kind: wire.Kind, Message: wire.Message}
	if err := protocol.ValidateTurn(turn); err != nil {
		return domain.AgentTurn{}, false, err
	}
	return turn, true, nil
}

func safeName(value string) (string, error) {
	name := strings.ReplaceAll(strings.TrimSpace(value), "\\", "/")
	if name == "" || strings.HasPrefix(name, "/") || strings.Contains(name, "\x00") {
		return "", fmt.Errorf("unsafe bundle entry path %q", value)
	}
	clean := path.Clean(name)
	if clean == "." || clean == ".." || strings.HasPrefix(clean, "../") || clean != name {
		return "", fmt.Errorf("unsafe bundle entry path %q", value)
	}
	return clean, nil
}

func safePatchName(value string) (string, error) {
	name, err := safeName(value)
	if err != nil {
		return "", err
	}
	if !strings.HasPrefix(name, "patches/") || !strings.HasSuffix(strings.ToLower(name), ".patch") {
		return "", fmt.Errorf("patch_file must be patches/*.patch, got %q", value)
	}
	return name, nil
}
