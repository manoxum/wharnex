package app

import (
	"archive/zip"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"unicode"

	"kernl.local/harness/backend/internal/app/contextbudget"
	"kernl.local/harness/backend/internal/domain"
)

const requestContextMapProtocol = "harness.context-map/v1"
const requestContextSemanticIndexProtocol = "harness.context-semantic-index/v1"

const maxContextSemanticSymbols = 16
const maxContextSemanticScanBytes = 128 << 10

type RequestContextMapFile struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

type RequestContextMaps struct {
	Protocol string                  `json:"protocol"`
	Files    []RequestContextMapFile `json:"files"`
}

type requestContextMapDocument struct {
	Protocol string                   `json:"protocol"`
	Source   string                   `json:"source"`
	Project  string                   `json:"project"`
	Coverage string                   `json:"coverage"`
	Entries  []requestContextMapEntry `json:"entries"`
	Note     string                   `json:"note"`
}

type requestContextMapEntry struct {
	Path        string `json:"path"`
	Status      string `json:"status"`
	Kind        string `json:"kind,omitempty"`
	Reason      string `json:"reason,omitempty"`
	Size        int64  `json:"size,omitempty"`
	SHA256      string `json:"sha256,omitempty"`
	ContentType string `json:"content_type,omitempty"`
}

type requestContextSemanticIndex struct {
	Protocol   string                    `json:"protocol"`
	Source     string                    `json:"source"`
	Project    string                    `json:"project"`
	Budget     contextbudget.Budget      `json:"budget"`
	Entries    []requestContextSemantic  `json:"entries"`
	Candidates []requestContextCandidate `json:"candidates"`
	Groups     []requestContextMapGroup  `json:"groups"`
	Note       string                    `json:"note"`
}

type requestContextSemantic struct {
	Path      string   `json:"path"`
	Selected  bool     `json:"selected"`
	Role      string   `json:"role"`
	Language  string   `json:"language,omitempty"`
	Symbols   []string `json:"symbols,omitempty"`
	Module    string   `json:"module"`
	Signals   []string `json:"signals,omitempty"`
	RelatedTo []string `json:"related_to,omitempty"`
	Size      int64    `json:"size"`
}

type requestContextCandidate struct {
	Path    string   `json:"path"`
	Reasons []string `json:"reasons"`
}

type requestContextMapGroup struct {
	ID    string   `json:"id"`
	Paths []string `json:"paths"`
}

type requestContextMapState struct {
	SelectedPaths []string
	RoundsUsed    int
	Query         string
}

type requestContextMapSource struct {
	label    string
	project  string
	root     string
	manifest domain.ContextManifest
}

func (s *Service) RequestContextMaps(sessionID string) (RequestContextMaps, error) {
	item, err := s.EnsureContextArtifacts(sessionID)
	if err != nil {
		return RequestContextMaps{}, fmt.Errorf("ensure context artifacts: %w", err)
	}
	files, err := requestContextMapFilesWithState(item.Context.ZipPath, item.Context.Manifest, requestContextMapState{SelectedPaths: item.ContextPaths, RoundsUsed: item.WorkflowRound, Query: item.LastManualPrompt})
	if err != nil {
		return RequestContextMaps{}, err
	}
	return RequestContextMaps{Protocol: requestContextMapProtocol, Files: files}, nil
}

func requestContextMapFiles(contextPath string, primary domain.ContextManifest) ([]RequestContextMapFile, error) {
	return requestContextMapFilesWithState(contextPath, primary, requestContextMapState{})
}

func requestContextMapFilesWithState(contextPath string, primary domain.ContextManifest, state requestContextMapState) ([]RequestContextMapFile, error) {
	sources, err := requestContextMapSources(contextPath, primary)
	if err != nil {
		return nil, err
	}
	archiveEntries, archiveSource, err := contextArchiveEntries(contextPath)
	if err != nil {
		return nil, err
	}
	defer archiveSource.Close()
	files := make([]RequestContextMapFile, 0, len(sources)*3)
	for _, source := range sources {
		mapRaw, err := requestContextMapJSON(source)
		if err != nil {
			return nil, err
		}
		semanticRaw, err := requestContextSemanticIndexJSON(source, state, archiveEntries)
		if err != nil {
			return nil, err
		}
		files = append(files,
			RequestContextMapFile{Path: requestContextMapRoot + source.label + "/maps", Content: string(mapRaw)},
			RequestContextMapFile{Path: requestContextMapRoot + source.label + "/semantic-index", Content: string(semanticRaw)},
			RequestContextMapFile{Path: requestContextMapRoot + source.label + "/sensitive-file-map", Content: requestSensitiveFileMap(source)},
		)
	}
	return files, nil
}

func requestContextMapSources(contextPath string, primary domain.ContextManifest) ([]requestContextMapSource, error) {
	sources := []requestContextMapSource{{label: "main", project: filepath.Base(primary.ProjectRoot), root: primary.ProjectRoot, manifest: primary}}
	archive, err := zip.OpenReader(filepath.Clean(contextPath))
	if err != nil {
		return nil, fmt.Errorf("open context archive for map: %w", err)
	}
	defer archive.Close()
	for _, entry := range archive.File {
		if filepath.ToSlash(filepath.Clean(entry.Name)) != legacyContextSourcesIndex || entry.FileInfo().IsDir() {
			continue
		}
		input, openErr := entry.Open()
		if openErr != nil {
			return nil, fmt.Errorf("open context source index for map: %w", openErr)
		}
		raw, readErr := io.ReadAll(io.LimitReader(input, 4<<20))
		closeErr := input.Close()
		if readErr != nil {
			return nil, fmt.Errorf("read context source index for map: %w", readErr)
		}
		if closeErr != nil {
			return nil, fmt.Errorf("close context source index for map: %w", closeErr)
		}
		var document requestContextSourcesDocument
		if err := json.Unmarshal(raw, &document); err != nil {
			return nil, fmt.Errorf("decode context source index for map: %w", err)
		}
		for index, project := range document.Projects {
			label := strings.Trim(strings.TrimPrefix(filepath.ToSlash(project.Prefix), legacyRelatedContextRoot), "/")
			if label == "" || !safeRemoteMapPath(label) {
				label = fmt.Sprintf("ref-%02d", index+1)
			}
			sources = append(sources, requestContextMapSource{label: "@ref/" + label, project: project.Name, root: project.ProjectPath, manifest: project.Manifest})
		}
		break
	}
	return sources, nil
}

func requestContextMapJSON(source requestContextMapSource) ([]byte, error) {
	entries := make([]requestContextMapEntry, 0, len(source.manifest.Files)+len(source.manifest.Excluded))
	for _, file := range source.manifest.Files {
		entries = append(entries, requestContextMapEntry{Path: file.Path, Status: "included", Kind: "file", Size: file.Size, SHA256: file.SHA256, ContentType: file.ContentType})
	}
	for _, excluded := range source.manifest.Excluded {
		path, reason := splitContextExclusion(excluded)
		if path == "" {
			continue
		}
		entries = append(entries, requestContextMapEntry{Path: path, Status: "excluded", Kind: contextMapPathKind(source.root, path), Reason: reason})
	}
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].Path == entries[j].Path {
			return entries[i].Status < entries[j].Status
		}
		return entries[i].Path < entries[j].Path
	})
	document := requestContextMapDocument{
		Protocol: requestContextMapProtocol,
		Source:   source.label,
		Project:  source.project,
		Coverage: "included files plus excluded files or subtree roots recorded by the context manifest",
		Entries:  entries,
		Note:     "This is path metadata only. Excluded subtree roots stand for their skipped descendants; secret values and excluded file contents are never exported here.",
	}
	raw, err := json.MarshalIndent(document, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("encode context map: %w", err)
	}
	return append(raw, '\n'), nil
}

func requestContextSemanticIndexJSON(source requestContextMapSource, state requestContextMapState, archiveEntries map[string]*zip.File) ([]byte, error) {
	entries := make([]requestContextSemantic, 0, len(source.manifest.Files))
	selected := make(map[string]struct{}, len(state.SelectedPaths))
	for _, path := range state.SelectedPaths {
		selected[path] = struct{}{}
	}
	selectedBytes := contextMapSelectedBytes(archiveEntries, state.SelectedPaths)
	for _, file := range source.manifest.Files {
		archivePath := contextMapArchivePath(source.label, file.Path)
		meta := contextMapSemanticMetadata(file.Path)
		_, bodySelected := selected[archivePath]
		entry := requestContextSemantic{
			Path: archivePath, Selected: bodySelected, Role: meta.role, Language: meta.language, Module: meta.module,
			Signals: meta.signals, Size: file.Size,
		}
		entry.Symbols = contextMapTopLevelSymbols(archiveEntries[archivePath], meta.language)
		entries = append(entries, entry)
	}
	applyContextRelations(entries)
	document := requestContextSemanticIndex{
		Protocol:   requestContextSemanticIndexProtocol,
		Source:     source.label,
		Project:    source.project,
		Budget:     contextbudget.New(selectedBytes, state.RoundsUsed),
		Entries:    entries,
		Candidates: contextMapCandidates(entries, selected, state.Query),
		Groups:     contextMapGroups(entries),
		Note:       "This index is advisory. Ranking and groups never authorize paths or impose a path-count limit; snapshot membership, cumulative bytes and path-safety validation remain authoritative. There is no increment-round limit: request more files only while they are needed and stop when the evidence suffices.",
	}
	raw, err := json.MarshalIndent(document, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("encode context semantic index: %w", err)
	}
	return append(raw, '\n'), nil
}

func contextMapSelectedBytes(entries map[string]*zip.File, paths []string) int64 {
	var total uint64
	seen := make(map[string]struct{}, len(paths))
	for _, name := range paths {
		if _, ok := seen[name]; ok {
			continue
		}
		seen[name] = struct{}{}
		if file := entries[name]; file != nil {
			total += file.UncompressedSize64
		}
	}
	if total > uint64(maxSelectedContextBytes) {
		return maxSelectedContextBytes
	}
	return int64(total)
}

type contextSelectionRankingMetrics struct {
	Candidates       int
	RequestedRanked  int
	TopTenHits       int
	RequestMatchHits int
	RankPositionSum  int
}

func contextMapSelectionRankingMetrics(contextPath string, manifest domain.ContextManifest, state requestContextMapState, requested []string) contextSelectionRankingMetrics {
	files, err := requestContextMapFilesWithState(contextPath, manifest, state)
	if err != nil {
		return contextSelectionRankingMetrics{}
	}
	requestedSet := make(map[string]struct{}, len(requested))
	for _, path := range requested {
		requestedSet[path] = struct{}{}
	}
	var metrics contextSelectionRankingMetrics
	for _, file := range files {
		if !strings.HasSuffix(file.Path, "/semantic-index") {
			continue
		}
		var index requestContextSemanticIndex
		if json.Unmarshal([]byte(file.Content), &index) != nil {
			continue
		}
		metrics.Candidates += len(index.Candidates)
		for position, candidate := range index.Candidates {
			if _, ok := requestedSet[candidate.Path]; !ok {
				continue
			}
			metrics.RequestedRanked++
			metrics.RankPositionSum += position + 1
			if position < 10 {
				metrics.TopTenHits++
			}
			for _, reason := range candidate.Reasons {
				if strings.HasSuffix(reason, "_match") {
					metrics.RequestMatchHits++
					break
				}
			}
		}
	}
	return metrics
}

type requestContextSemanticMeta struct {
	role     string
	language string
	module   string
	signals  []string
}

func contextMapArchivePath(label, relative string) string {
	if strings.HasPrefix(label, "@ref/") {
		return requestReferenceContextRoot + strings.TrimPrefix(label, "@ref/") + "/" + relative
	}
	return requestPrimaryContextRoot + relative
}

func contextMapSemanticMetadata(name string) requestContextSemanticMeta {
	clean := filepath.ToSlash(strings.TrimSpace(name))
	ext := strings.ToLower(filepath.Ext(clean))
	language := map[string]string{
		".go": "go", ".js": "javascript", ".mjs": "javascript", ".cjs": "javascript", ".ts": "typescript", ".tsx": "typescript", ".jsx": "javascript",
		".json": "json", ".md": "markdown", ".sql": "sql", ".yaml": "yaml", ".yml": "yaml", ".sh": "shell", ".py": "python",
	}[ext]
	base := strings.ToLower(filepath.Base(clean))
	role := "source"
	signals := []string{}
	switch {
	case strings.Contains(base, "test") || strings.Contains(base, "spec"):
		role = "test"
		signals = append(signals, "test_pair")
	case strings.HasPrefix(strings.ToLower(clean), "schemas/") || strings.Contains(base, "schema"):
		role = "schema"
		signals = append(signals, "protocol_contract")
	case strings.HasPrefix(strings.ToLower(clean), "sot/") || strings.HasPrefix(strings.ToLower(clean), "adr/"):
		role = "policy_doc"
		signals = append(signals, "policy_doc")
	case ext == ".md":
		role = "documentation"
	case strings.Contains(base, "config") || base == "package.json" || base == "go.mod":
		role = "configuration"
	}
	parts := strings.Split(clean, "/")
	module := "."
	if len(parts) > 1 {
		module = strings.Join(parts[:len(parts)-1], "/")
	}
	if strings.Contains(base, "context") {
		signals = append(signals, "context_protocol")
	}
	if strings.Contains(base, "prompt") {
		signals = append(signals, "prompt_contract")
	}
	return requestContextSemanticMeta{role: role, language: language, module: module, signals: uniqueSortedStrings(signals)}
}

func contextMapTopLevelSymbols(file *zip.File, language string) []string {
	if file == nil || language == "" || language == "json" || language == "markdown" || language == "yaml" || language == "sql" {
		return nil
	}
	input, err := file.Open()
	if err != nil {
		return nil
	}
	raw, readErr := io.ReadAll(io.LimitReader(input, maxContextSemanticScanBytes))
	_ = input.Close()
	if readErr != nil || strings.ContainsRune(string(raw), '\x00') {
		return nil
	}
	result := make([]string, 0, maxContextSemanticSymbols)
	seen := map[string]struct{}{}
	for _, line := range strings.Split(string(raw), "\n") {
		if len(result) >= maxContextSemanticSymbols {
			break
		}
		if strings.TrimSpace(line) == "" || len(line) != len(strings.TrimLeftFunc(line, unicode.IsSpace)) {
			continue
		}
		for _, candidate := range contextMapSymbolsFromLine(strings.TrimSpace(line), language) {
			if _, ok := seen[candidate]; ok || candidate == "" {
				continue
			}
			seen[candidate] = struct{}{}
			result = append(result, candidate)
			if len(result) >= maxContextSemanticSymbols {
				break
			}
		}
	}
	return result
}

func contextMapSymbolsFromLine(line, language string) []string {
	prefixes := []string{}
	switch language {
	case "go":
		if strings.HasPrefix(line, "func (") {
			if close := strings.Index(line, ") "); close >= 0 {
				return []string{contextMapIdentifier(strings.TrimSpace(line[close+2:]))}
			}
		}
		prefixes = []string{"func ", "type "}
	case "javascript", "typescript":
		prefixes = []string{"export async function ", "export function ", "async function ", "function ", "export default class ", "export class ", "class ", "export interface ", "interface ", "export type ", "type ", "export const ", "const ", "export let ", "let "}
	case "python":
		prefixes = []string{"async def ", "def ", "class "}
	case "shell":
		if strings.HasSuffix(line, "() {") {
			return []string{strings.TrimSpace(strings.TrimSuffix(line, "() {"))}
		}
	}
	for _, prefix := range prefixes {
		if strings.HasPrefix(line, prefix) {
			return []string{contextMapIdentifier(strings.TrimSpace(strings.TrimPrefix(line, prefix)))}
		}
	}
	return nil
}

func contextMapIdentifier(value string) string {
	end := 0
	for end < len(value) {
		r := rune(value[end])
		if !(r == '_' || r == '$' || unicode.IsLetter(r) || (end > 0 && unicode.IsDigit(r))) {
			break
		}
		end++
	}
	if end == 0 {
		return ""
	}
	return value[:end]
}

func applyContextRelations(entries []requestContextSemantic) {
	byStem := make(map[string][]string)
	for _, entry := range entries {
		stem := contextMapRelationStem(entry.Path)
		byStem[stem] = append(byStem[stem], entry.Path)
	}
	for i := range entries {
		for _, related := range byStem[contextMapRelationStem(entries[i].Path)] {
			if related != entries[i].Path {
				entries[i].RelatedTo = append(entries[i].RelatedTo, related)
			}
		}
		sort.Strings(entries[i].RelatedTo)
	}
}

func contextMapRelationStem(name string) string {
	clean := filepath.ToSlash(name)
	base := strings.ToLower(filepath.Base(clean))
	stem := strings.TrimSuffix(base, filepath.Ext(base))
	for _, suffix := range []string{"_test", ".test", "-test", ".spec", "_spec"} {
		stem = strings.TrimSuffix(stem, suffix)
	}
	return filepath.ToSlash(filepath.Dir(clean)) + "/" + stem
}

func contextMapCandidates(entries []requestContextSemantic, selected map[string]struct{}, query string) []requestContextCandidate {
	candidates := make([]requestContextCandidate, 0, len(entries))
	for _, entry := range entries {
		if _, ok := selected[entry.Path]; ok {
			continue
		}
		reasons := append([]string(nil), entry.Signals...)
		reasons = append(reasons, contextMapRequestReasons(entry, query)...)
		if entry.Role == "test" {
			reasons = append(reasons, "test_pair")
		}
		if len(entry.RelatedTo) > 0 {
			reasons = append(reasons, "related_to")
		}
		if len(reasons) == 0 {
			reasons = append(reasons, "snapshot_file")
		}
		candidates = append(candidates, requestContextCandidate{Path: entry.Path, Reasons: uniqueSortedStrings(reasons)})
	}
	sort.SliceStable(candidates, func(i, j int) bool {
		left, right := contextMapCandidateScore(candidates[i]), contextMapCandidateScore(candidates[j])
		if left == right {
			return candidates[i].Path < candidates[j].Path
		}
		return left > right
	})
	return candidates
}

func contextMapCandidateScore(candidate requestContextCandidate) int {
	score := len(candidate.Reasons)
	for _, reason := range candidate.Reasons {
		if strings.HasSuffix(reason, "_match") {
			score += 4
		}
	}
	return score
}

func contextMapRequestReasons(entry requestContextSemantic, query string) []string {
	query = strings.ToLower(strings.TrimSpace(query))
	if query == "" {
		return nil
	}
	reasons := []string{}
	for _, symbol := range entry.Symbols {
		token := strings.ToLower(strings.TrimSpace(symbol))
		if len(token) >= 4 && strings.Contains(query, token) {
			reasons = append(reasons, "symbol_match")
			break
		}
	}
	if contextMapTextMatchesQuery(entry.Path, query) {
		reasons = append(reasons, "path_match")
	}
	if contextMapTextMatchesQuery(entry.Module, query) {
		reasons = append(reasons, "module_match")
	}
	return uniqueSortedStrings(reasons)
}

func contextMapTextMatchesQuery(value, query string) bool {
	for _, token := range strings.FieldsFunc(strings.ToLower(value), func(r rune) bool {
		return !(r >= 'a' && r <= 'z') && !(r >= '0' && r <= '9')
	}) {
		if len(token) >= 4 && strings.Contains(query, token) {
			return true
		}
	}
	return false
}

func contextMapGroups(entries []requestContextSemantic) []requestContextMapGroup {
	groups := map[string][]string{}
	for _, entry := range entries {
		key := entry.Module
		if key == "" {
			key = "."
		}
		groups[key] = append(groups[key], entry.Path)
	}
	keys := make([]string, 0, len(groups))
	for key := range groups {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	result := make([]requestContextMapGroup, 0, len(keys))
	for _, key := range keys {
		paths := groups[key]
		if len(paths) < 2 {
			continue
		}
		sort.Strings(paths)
		result = append(result, requestContextMapGroup{ID: key, Paths: paths})
	}
	return result
}

func uniqueSortedStrings(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}

func splitContextExclusion(value string) (string, string) {
	value = strings.TrimSpace(value)
	if strings.HasSuffix(value, ")") {
		if index := strings.LastIndex(value, " ("); index > 0 {
			return strings.TrimSpace(value[:index]), strings.TrimSpace(value[index+2 : len(value)-1])
		}
	}
	return value, "excluded by context policy"
}

func contextMapPathKind(root, relative string) string {
	path, ok := contextMapHostPath(root, relative)
	if !ok {
		return "unknown"
	}
	info, err := os.Lstat(path)
	if err != nil {
		return "unknown"
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return "symlink"
	}
	if info.IsDir() {
		return "directory"
	}
	if info.Mode().IsRegular() {
		return "file"
	}
	return "other"
}

func contextMapHostPath(root, relative string) (string, bool) {
	clean := filepath.Clean(filepath.FromSlash(strings.TrimSpace(relative)))
	if clean == "." || filepath.IsAbs(clean) || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return "", false
	}
	absoluteRoot, err := filepath.Abs(root)
	if err != nil {
		return "", false
	}
	candidate := filepath.Join(absoluteRoot, clean)
	rel, err := filepath.Rel(absoluteRoot, candidate)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", false
	}
	return candidate, true
}
