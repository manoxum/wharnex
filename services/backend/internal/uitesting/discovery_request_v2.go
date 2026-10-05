package uitesting

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// DiscoveryInput is everything one v2 discovery or design exchange sends.
type DiscoveryInput struct {
	TaskID         string
	Task           string
	ContextSHA256  string
	ContextArchive []byte
	Catalog        CatalogInput
	Brief          string
	EnvironmentID  string
	Metadata       DiscoveryRequestMetadata
}

// CatalogInput is the current catalog as GPT sees it: definitions, local
// configuration state and the latest outcome. It never carries credentials or
// session material — a profile only says whether it is configured.
type CatalogInput struct {
	Protocol     string               `json:"protocol"`
	Environments []CatalogEnvironment `json:"environments"`
	Tests        []CatalogTest        `json:"tests"`
}

type CatalogEnvironment struct {
	Environment
	URLConfigured bool `json:"url_configured"`
}

type CatalogTest struct {
	TestCase
	LastRun *CatalogRunSummary `json:"last_run,omitempty"`
}

type CatalogRunSummary struct {
	Status      string    `json:"status"`
	Error       string    `json:"error,omitempty"`
	CompletedAt time.Time `json:"completed_at,omitempty"`
}

// NewCatalogInput projects a stored document into the request catalog.
func NewCatalogInput(doc Document) CatalogInput {
	runs := map[string]Run{}
	for _, run := range doc.Runs {
		runs[run.ID] = run
	}
	input := CatalogInput{Protocol: CatalogInputProtocolV1, Environments: []CatalogEnvironment{}, Tests: []CatalogTest{}}
	for _, env := range doc.Environments {
		input.Environments = append(input.Environments, CatalogEnvironment{Environment: env, URLConfigured: strings.TrimSpace(env.URL) != ""})
	}
	for _, test := range doc.Tests {
		item := CatalogTest{TestCase: test}
		item.Access = EffectiveAccess(test)
		if item.Source == "" {
			item.Source = SourceDiscovered
		}
		if run, ok := runs[test.LastRunID]; ok {
			item.LastRun = &CatalogRunSummary{Status: run.Status, Error: truncate(run.Error, 300), CompletedAt: run.CompletedAt}
		}
		input.Tests = append(input.Tests, item)
	}
	return input
}

// BuildDiscoveryRequestV2 builds the request archive for a synchronization or
// an operator-requested test design.
func BuildDiscoveryRequestV2(input DiscoveryInput) (DiscoveryTransportManifest, []byte, error) {
	if input.Task != DiscoveryTask && input.Task != DesignTask {
		return DiscoveryTransportManifest{}, nil, fmt.Errorf("unsupported UI discovery task %q", input.Task)
	}
	brief := strings.TrimSpace(input.Brief)
	if (input.Task == DesignTask) != (brief != "") || len(brief) > MaxDesignBrief {
		return DiscoveryTransportManifest{}, nil, fmt.Errorf("UI test design needs one brief of at most %d bytes", MaxDesignBrief)
	}
	requestFilename, err := DiscoveryRequestFilename(input.TaskID)
	if err != nil {
		return DiscoveryTransportManifest{}, nil, err
	}
	resultFilename, _ := DiscoveryResultFilename(input.TaskID)
	contextSHA256 := strings.ToLower(strings.TrimSpace(input.ContextSHA256))
	if len(contextSHA256) != 64 || len(input.ContextArchive) == 0 {
		return DiscoveryTransportManifest{}, nil, fmt.Errorf("UI discovery context is invalid")
	}
	catalog, err := json.MarshalIndent(input.Catalog, "", "  ")
	if err != nil {
		return DiscoveryTransportManifest{}, nil, fmt.Errorf("encode UI catalog: %w", err)
	}
	sourceDigest, catalogDigest := sha256.Sum256(input.ContextArchive), sha256.Sum256(catalog)
	manifest := DiscoveryTransportManifest{
		Protocol: DiscoveryRequestProtocolV2, Task: input.Task, TaskID: input.TaskID,
		ContextSHA256: contextSHA256, SourceSHA256: hex.EncodeToString(sourceDigest[:]),
		RequestFilename: requestFilename, ResultFilename: resultFilename,
		ContextPath: DiscoveryContextPath, ResultPath: DiscoveryResultPath,
		CatalogPath: DiscoveryCatalogPath, CatalogSHA256: hex.EncodeToString(catalogDigest[:]),
		RequestMetadata: normalizeDiscoveryMetadata(input.TaskID, input.Metadata),
	}
	if brief != "" {
		manifest.BriefPath = DiscoveryBriefPath
	}
	transport, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return DiscoveryTransportManifest{}, nil, fmt.Errorf("encode UI discovery manifest: %w", err)
	}
	entries := []zipEntry{
		{DiscoveryTransportPath, transport},
		{DiscoveryPromptPath, []byte(discoveryPromptV2(manifest, input.EnvironmentID))},
		{DiscoveryContextPath, input.ContextArchive},
		{DiscoveryCatalogPath, catalog},
	}
	if brief != "" {
		entries = append(entries, zipEntry{DiscoveryBriefPath, []byte(brief + "\n")})
	}
	bundle, err := writeZip(entries)
	if err != nil {
		return DiscoveryTransportManifest{}, nil, err
	}
	return manifest, bundle, nil
}

type zipEntry struct {
	name string
	data []byte
}

func writeZip(entries []zipEntry) ([]byte, error) {
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	for _, entry := range entries {
		part, err := writer.Create(entry.name)
		if err != nil {
			return nil, fmt.Errorf("create UI discovery entry %s: %w", entry.name, err)
		}
		if _, err := part.Write(entry.data); err != nil {
			return nil, fmt.Errorf("write UI discovery entry %s: %w", entry.name, err)
		}
	}
	if err := writer.Close(); err != nil {
		return nil, fmt.Errorf("finish UI discovery request: %w", err)
	}
	return buffer.Bytes(), nil
}

func truncate(value string, limit int) string {
	value = strings.TrimSpace(value)
	if len(value) <= limit {
		return value
	}
	return value[:limit]
}
