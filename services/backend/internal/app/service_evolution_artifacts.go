package app

import (
	"archive/zip"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"unicode/utf8"

	"kernl.local/harness/backend/internal/audit"
)

const maxEvolutionEvidenceArtifacts = 8
const maxEvolutionEvidenceArchiveEntries = 40
const maxEvolutionEvidenceEntryBytes = 512 << 10

var importedEvidenceSecret = regexp.MustCompile(`(?i)(api[_-]?key|token|password|secret|credential)\s*["']?\s*[:=]\s*["']?[^\s,"'}]+`)

func (s *Service) evolutionEvidenceArtifacts(ctx context.Context, sessionID string, ids []string) (string, error) {
	if len(ids) > maxEvolutionEvidenceArtifacts {
		return "", fmt.Errorf("at most %d operational evidence files may be analyzed together", maxEvolutionEvidenceArtifacts)
	}
	seen := map[string]bool{}
	sections := make([]string, 0, len(ids))
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		record, raw, err := s.ReadArtifact(ctx, sessionID, id)
		if err != nil {
			return "", fmt.Errorf("read imported operational evidence: %w", err)
		}
		if record.Direction != "input" || record.Kind != "operational-evidence" {
			return "", errors.New("only explicitly imported operational evidence may be analyzed")
		}
		text, err := operationalEvidenceText(raw, record.Name)
		if err != nil {
			return "", fmt.Errorf("inspect %q: %w", record.Name, err)
		}
		sections = append(sections, "IMPORTED ARTIFACT · "+record.Name+"\n"+text)
	}
	return strings.Join(sections, "\n\n"), nil
}

func operationalEvidenceText(raw []byte, name string) (string, error) {
	if strings.EqualFold(filepath.Ext(name), ".zip") {
		return operationalEvidenceZIP(raw)
	}
	if !utf8.Valid(raw) {
		return "", errors.New("evidence must be UTF-8 text or a ZIP archive")
	}
	return sanitizeOperationalEvidenceText(string(raw)), nil
}

func operationalEvidenceZIP(raw []byte) (string, error) {
	reader, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		return "", errors.New("invalid ZIP evidence archive")
	}
	files := make([]*zip.File, 0, len(reader.File))
	for _, file := range reader.File {
		if evidenceArchiveEntry(file) {
			files = append(files, file)
		}
	}
	sort.Slice(files, func(i, j int) bool { return files[i].Name < files[j].Name })
	if len(files) > maxEvolutionEvidenceArchiveEntries {
		files = files[:maxEvolutionEvidenceArchiveEntries]
	}
	sections := make([]string, 0, len(files))
	for _, file := range files {
		handle, err := file.Open()
		if err != nil {
			return "", err
		}
		data, readErr := io.ReadAll(io.LimitReader(handle, maxEvolutionEvidenceEntryBytes+1))
		closeErr := handle.Close()
		if readErr != nil {
			return "", readErr
		}
		if closeErr != nil {
			return "", closeErr
		}
		if len(data) > maxEvolutionEvidenceEntryBytes || !utf8.Valid(data) {
			continue
		}
		sections = append(sections, "ENTRY · "+file.Name+"\n"+sanitizeOperationalEvidenceText(string(data)))
	}
	if len(sections) == 0 {
		return "", errors.New("ZIP contains no bounded UTF-8 log, plan, execution or JSON entry")
	}
	return strings.Join(sections, "\n\n"), nil
}

func sanitizeOperationalEvidenceText(value string) string {
	return importedEvidenceSecret.ReplaceAllString(audit.SanitizeText(value), "$1=[REDACTED]")
}

func evidenceArchiveEntry(file *zip.File) bool {
	clean := strings.TrimPrefix(filepath.ToSlash(filepath.Clean(file.Name)), "./")
	if clean == "." || strings.HasPrefix(clean, "../") || file.FileInfo().IsDir() || file.UncompressedSize64 > maxEvolutionEvidenceEntryBytes {
		return false
	}
	ext := strings.ToLower(filepath.Ext(clean))
	if ext != ".md" && ext != ".json" && ext != ".log" && ext != ".txt" {
		return false
	}
	return strings.Contains(clean, "execution/") || strings.Contains(clean, "planner/") || strings.Contains(clean, "session/") || strings.Contains(clean, "chat/") || strings.Contains(clean, "event") || ext == ".md" || ext == ".log"
}
