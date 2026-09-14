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
	MaxBundleBytes    = 16 << 20
	maxExpandedBytes  = 32 << 20
	maxEntries        = 256
	maxKnowledgeBytes = 256 << 10
	// maxAttemptLedgerBytes bounds attempts/ledger.md. The ledger is a distilled
	// decision aid, not a transcript; anything larger is a sign the planner is
	// pasting logs into it and is dropped rather than carried forward.
	maxAttemptLedgerBytes = 64 << 10
)

type operationWire struct {
	Type      string             `json:"type"`
	Patch     string             `json:"patch,omitempty"`
	PatchFile string             `json:"patch_file,omitempty"`
	Command   domain.CommandSpec `json:"command"`
}

type planWire struct {
	Protocol          string                   `json:"protocol"`
	BaseContextSHA256 string                   `json:"base_context_sha256,omitempty"`
	ImpactFiles       []string                 `json:"impact_files,omitempty"`
	ReadFiles         []string                 `json:"read_files,omitempty"`
	BarrierFiles      []string                 `json:"barrier_files,omitempty"`
	PlanID            string                   `json:"plan_id"`
	RequestID         string                   `json:"request_id"`
	Status            string                   `json:"status"`
	Summary           string                   `json:"summary"`
	VersionIncrement  *domain.VersionIncrement `json:"version_increment,omitempty"`
	CommitMessage     string                   `json:"commit_message,omitempty"`
	Risk              string                   `json:"risk"`
	RequiresApproval  bool                     `json:"requires_approval"`
	Operations        []operationWire          `json:"operations"`
	Verification      []domain.CommandSpec     `json:"verification"`
	CrossProject      []crossProjectUnitWire   `json:"cross_project,omitempty"`
}

// crossProjectUnitWire is one complete change for a granted referenced project.
// Its operations resolve `patch_file` from the same `patches/` directory as the
// primary plan's, so a cross-project patch is an ordinary bundle entry rather
// than a second transport.
type crossProjectUnitWire struct {
	Project       string               `json:"project"`
	CommitMessage string               `json:"commit_message"`
	Summary       string               `json:"summary,omitempty"`
	Operations    []operationWire      `json:"operations"`
	Verification  []domain.CommandSpec `json:"verification,omitempty"`
}

type Parsed struct {
	Plan *domain.ExecutionPlan
	Turn domain.AgentTurn
	Info domain.ExecutionBundleInfo
}

type turnWire struct {
	Protocol            string              `json:"protocol"`
	RequestID           string              `json:"request_id"`
	Kind                domain.TurnKind     `json:"kind"`
	ChatTitle           string              `json:"chat_title,omitempty"`
	Message             string              `json:"message"`
	Outcome             *domain.TurnOutcome `json:"outcome"`
	ResolvedEvidenceIDs []string            `json:"resolved_evidence_ids,omitempty"`
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

	files, _, err = normalizeBundleRoot(files)
	if err != nil {
		return Parsed{}, err
	}
	readmeBytes := files["README.md"]
	if len(readmeBytes) > 1<<20 {
		return Parsed{}, errors.New("README.md exceeds 1 MiB limit")
	}
	knowledgeBytes := files["knowledge.md"]
	if len(knowledgeBytes) > maxKnowledgeBytes {
		return Parsed{}, errors.New("knowledge.md exceeds 256 KiB limit")
	}
	summaryBytes := files["summary.md"]
	if len(summaryBytes) > 256<<10 {
		return Parsed{}, errors.New("summary.md exceeds 256 KiB limit")
	}
	// attempts/ledger.md is the planner's cumulative account of what this Main
	// Request has already proven to work and to fail locally. It is bookkeeping
	// that makes the NEXT round cheaper, so an absent or oversized ledger is
	// never a parse failure: rejecting a bundle over it would discard a verified
	// patch to protect a note about patches. An oversized one is dropped and the
	// previous round's ledger is retained instead.
	ledgerBytes := files["attempts/ledger.md"]
	if len(ledgerBytes) > maxAttemptLedgerBytes {
		ledgerBytes = nil
	}
	knowledgeCandidate, err := parseKnowledgeCandidate(files)
	if err != nil {
		return Parsed{}, err
	}
	turn, hasTurn, err := parseTurn(files["turn.json"])
	if err != nil {
		return Parsed{}, err
	}
	planBytes, hasPlan := files["plan.json"]
	if !hasTurn && !hasPlan {
		return Parsed{}, errors.New("execution bundle requires turn.json or plan.json")
	}
	if hasTurn && turn.Outcome.Status == domain.TurnOutcomeCompleted && turnCarriesPlan(turn.Kind) && !hasPlan {
		return Parsed{}, fmt.Errorf("%s turn requires plan.json", turn.Kind)
	}
	if hasTurn && !turnCarriesPlan(turn.Kind) && hasPlan {
		return Parsed{}, errors.New("only change or workflow turns may contain plan.json")
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
			Protocol: wire.Protocol, BaseContextSHA256: wire.BaseContextSHA256, ImpactFiles: wire.ImpactFiles, ReadFiles: wire.ReadFiles, BarrierFiles: wire.BarrierFiles, PlanID: wire.PlanID, RequestID: wire.RequestID,
			Status: wire.Status, Summary: wire.Summary, VersionIncrement: wire.VersionIncrement, CommitMessage: wire.CommitMessage, Risk: wire.Risk,
			RequiresApproval: wire.RequiresApproval, Operations: make([]domain.Operation, 0), Verification: wire.Verification,
		}
		if resolvedPlan.Verification == nil {
			resolvedPlan.Verification = make([]domain.CommandSpec, 0)
		}
		resolveOperations := func(label string, wired []operationWire) ([]domain.Operation, error) {
			operations := make([]domain.Operation, 0, len(wired))
			for index, op := range wired {
				resolved := domain.Operation{Type: op.Type, Patch: op.Patch, Command: op.Command}
				if op.Type == "apply_patch" && op.PatchFile != "" {
					if strings.TrimSpace(op.Patch) != "" {
						return nil, fmt.Errorf("%soperation %d cannot contain both patch and patch_file", label, index)
					}
					patchName, patchErr := normalizedPatchName(op.PatchFile)
					if patchErr != nil {
						return nil, fmt.Errorf("%soperation %d: %w", label, index, patchErr)
					}
					patchBytes, exists := files[patchName]
					if !exists {
						legacyName := path.Base(patchName)
						patchBytes, exists = files[legacyName]
						if exists {
							files[patchName] = patchBytes
							delete(files, legacyName)
						}
					}
					if !exists {
						return nil, fmt.Errorf("%soperation %d references missing %s", label, index, patchName)
					}
					resolved.Patch = string(patchBytes)
					patches = append(patches, patchName)
				}
				operations = append(operations, resolved)
			}
			return operations, nil
		}
		primaryOperations, err := resolveOperations("", wire.Operations)
		if err != nil {
			return Parsed{}, err
		}
		resolvedPlan.Operations = primaryOperations
		for unitIndex, unit := range wire.CrossProject {
			label := fmt.Sprintf("cross_project %d: ", unitIndex)
			unitOperations, unitErr := resolveOperations(label, unit.Operations)
			if unitErr != nil {
				return Parsed{}, unitErr
			}
			resolvedPlan.CrossProject = append(resolvedPlan.CrossProject, domain.CrossProjectUnit{
				Project: unit.Project, CommitMessage: unit.CommitMessage, Summary: unit.Summary,
				Operations: unitOperations, Verification: unit.Verification,
			})
		}
		plan = &resolvedPlan
		if !hasTurn {
			turn = domain.AgentTurn{Protocol: domain.TurnProtocolV1, RequestID: plan.RequestID, Kind: domain.TurnKindChange, Message: plan.Summary, Outcome: completedTurnOutcome()}
		}
		if turn.RequestID != plan.RequestID {
			return Parsed{}, errors.New("turn.json/plan.json request_id mismatch")
		}
	}
	if hasTurn && turn.Outcome.Status != domain.TurnOutcomeCompleted && plan != nil {
		return Parsed{}, errors.New("non-completed turn outcome must not contain plan.json")
	}

	if len(bytes.TrimSpace(readmeBytes)) == 0 {
		readmeBytes = synthesizeREADME(turn, plan)
		if len(bytes.TrimSpace(readmeBytes)) == 0 {
			return Parsed{}, errors.New("execution bundle requires non-empty README.md or structured turn/plan text")
		}
		files["README.md"] = readmeBytes
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
		CumulativeSummary: strings.TrimSpace(string(summaryBytes)), ProjectKnowledgeCandidate: knowledgeCandidate,
		AttemptLedgerNarrative: strings.TrimSpace(string(ledgerBytes)),
		ProjectKnowledgeUpdate: string(knowledgeBytes),
	}, Turn: turn}, nil
}

func completedTurnOutcome() *domain.TurnOutcome {
	return &domain.TurnOutcome{Status: domain.TurnOutcomeCompleted}
}

func turnCarriesPlan(kind domain.TurnKind) bool {
	return kind == domain.TurnKindChange || kind == domain.TurnKindWorkflow
}

func normalizeBundleRoot(files map[string][]byte) (map[string][]byte, string, error) {
	if len(files) == 0 || files["README.md"] != nil || files["turn.json"] != nil || files["plan.json"] != nil {
		return files, "", nil
	}
	prefix := ""
	for name := range files {
		parts := strings.SplitN(name, "/", 2)
		if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
			return files, "", nil
		}
		if prefix == "" {
			prefix = parts[0]
		} else if parts[0] != prefix {
			return files, "", nil
		}
	}
	if files[prefix+"/turn.json"] == nil && files[prefix+"/plan.json"] == nil {
		return files, "", nil
	}
	normalized := make(map[string][]byte, len(files))
	for name, data := range files {
		name = strings.TrimPrefix(name, prefix+"/")
		if _, duplicate := normalized[name]; duplicate {
			return nil, "", fmt.Errorf("duplicate bundle entry after removing wrapper %q: %s", prefix, name)
		}
		normalized[name] = data
	}
	return normalized, prefix, nil
}

func synthesizeREADME(turn domain.AgentTurn, plan *domain.ExecutionPlan) []byte {
	message := strings.TrimSpace(turn.Message)
	if message == "" && plan != nil {
		message = strings.TrimSpace(plan.Summary)
	}
	if message == "" {
		return nil
	}
	return []byte("# Wharnex result\n\n> README.md synthesized by Wharnex from structured bundle metadata because the transport omitted the documentation file. No executable semantics were inferred.\n\n" + message + "\n")
}

func normalizedPatchName(value string) (string, error) {
	name, err := safeName(value)
	if err != nil {
		return "", err
	}
	if !strings.Contains(name, "/") && strings.HasSuffix(strings.ToLower(name), ".patch") {
		name = "patches/" + name
	}
	return safePatchName(name)
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
	turn := domain.AgentTurn{Protocol: wire.Protocol, RequestID: wire.RequestID, Kind: wire.Kind, ChatTitle: wire.ChatTitle, Message: wire.Message, Outcome: wire.Outcome, ResolvedEvidenceIDs: wire.ResolvedEvidenceIDs}
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
