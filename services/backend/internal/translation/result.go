package translation

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"path"
	"strings"
	"unicode/utf8"
)

// ParseResult validates one translation response bundle against the request it
// answers, and returns the translated document only if every check holds.
//
// Every failure here is a refusal, never a repair. The whole point of moving
// translation onto a bundle is that an answer can now be wrong in a way Wharnex
// can name — wrong document, wrong language, wrong task, prose instead of a
// file — instead of being an attachment that either showed up or did not.
func ParseResult(filename string, raw []byte, request TransportManifest) (Result, error) {
	expectedName, err := ResultFilename(request.TaskID)
	if err != nil {
		return Result{}, err
	}
	if path.Base(strings.TrimSpace(filename)) != expectedName {
		return Result{}, fmt.Errorf("translation bundle filename %q is not %q", filename, expectedName)
	}
	if len(raw) == 0 || len(raw) > MaxBundleBytes {
		return Result{}, fmt.Errorf("translation bundle size must be between 1 byte and %d bytes", MaxBundleBytes)
	}
	files, err := readArchive(raw)
	if err != nil {
		return Result{}, err
	}

	manifestBytes, ok := files[ResultManifestPath]
	if !ok {
		return Result{}, fmt.Errorf("translation bundle is missing %s", ResultManifestPath)
	}
	var manifest ResultManifest
	decoder := json.NewDecoder(bytes.NewReader(manifestBytes))
	// Unknown fields are refused rather than ignored: this document is small,
	// fully specified, and a producer inventing fields in it is a producer that
	// has not read the contract.
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&manifest); err != nil {
		return Result{}, fmt.Errorf("decode %s: %w", ResultManifestPath, err)
	}
	if manifest.Protocol != ResultProtocolV1 {
		return Result{}, fmt.Errorf("unsupported translation protocol %q", manifest.Protocol)
	}
	if manifest.Task != TaskTranslateDocument {
		return Result{}, fmt.Errorf("unsupported translation task %q", manifest.Task)
	}
	if strings.TrimSpace(manifest.TaskID) != strings.TrimSpace(request.TaskID) {
		return Result{}, fmt.Errorf("translation bundle answers task %q, not %q", manifest.TaskID, request.TaskID)
	}
	if !strings.EqualFold(strings.TrimSpace(manifest.TargetLanguage), request.TargetLanguage) {
		return Result{}, fmt.Errorf("translation bundle targets %q, not %q", manifest.TargetLanguage, request.TargetLanguage)
	}
	// The digest is the contract's centre: it is what turns "a file arrived"
	// into "this is the translation of the document we sent".
	if !strings.EqualFold(strings.TrimSpace(manifest.SourceSHA256), request.SourceSHA256) {
		return Result{}, fmt.Errorf("translation bundle declares a different source document")
	}
	resultPath := strings.TrimSpace(manifest.ResultPath)
	if resultPath == "" {
		resultPath = request.ResultPath
	}
	if resultPath != request.ResultPath {
		return Result{}, fmt.Errorf("translation bundle declares result path %q, not %q", resultPath, request.ResultPath)
	}

	document, ok := files[request.ResultPath]
	if !ok {
		return Result{}, fmt.Errorf("translation bundle is missing %s", request.ResultPath)
	}
	if len(document) == 0 {
		return Result{}, fmt.Errorf("translation bundle delivered an empty %s", request.ResultPath)
	}
	if len(document) > MaxResultBytes {
		return Result{}, fmt.Errorf("translated document exceeds %d bytes", MaxResultBytes)
	}
	if !utf8.Valid(document) {
		return Result{}, fmt.Errorf("translated document is not valid UTF-8")
	}
	return Result{
		TaskID: request.TaskID, TargetLanguage: request.TargetLanguage,
		SourceSHA256: request.SourceSHA256, Markdown: string(document),
	}, nil
}

// readArchive applies the same structural boundary every Wharnex bundle gets:
// relative traversal-free names, no symlinks, bounded entry count, and a
// bounded expansion so a small archive cannot become a large one.
func readArchive(raw []byte) (map[string][]byte, error) {
	reader, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		return nil, fmt.Errorf("open translation bundle zip: %w", err)
	}
	if len(reader.File) == 0 || len(reader.File) > maxEntries {
		return nil, fmt.Errorf("translation bundle must contain 1..%d entries", maxEntries)
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
			return nil, err
		}
		if entry.FileInfo().Mode()&0o170000 == 0o120000 {
			return nil, fmt.Errorf("translation bundle symlink is forbidden: %s", name)
		}
		if isDir {
			continue
		}
		expanded += int64(entry.UncompressedSize64)
		if expanded > maxExpandedBytes {
			return nil, fmt.Errorf("translation bundle expanded size exceeds %d bytes", maxExpandedBytes)
		}
		rc, err := entry.Open()
		if err != nil {
			return nil, fmt.Errorf("open translation bundle entry %s: %w", name, err)
		}
		data, readErr := io.ReadAll(io.LimitReader(rc, maxExpandedBytes+1))
		_ = rc.Close()
		if readErr != nil {
			return nil, fmt.Errorf("read translation bundle entry %s: %w", name, readErr)
		}
		if _, duplicate := files[name]; duplicate {
			return nil, fmt.Errorf("duplicate translation bundle entry: %s", name)
		}
		files[name] = data
	}
	return files, nil
}

func safeName(name string) (string, error) {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		return "", fmt.Errorf("translation bundle entry has an empty name")
	}
	if strings.ContainsRune(trimmed, '\\') {
		return "", fmt.Errorf("translation bundle entry name is not a relative POSIX path: %s", name)
	}
	if strings.HasPrefix(trimmed, "/") {
		return "", fmt.Errorf("translation bundle entry name must be relative: %s", name)
	}
	cleaned := path.Clean(trimmed)
	if cleaned != trimmed || cleaned == "." || cleaned == ".." || strings.HasPrefix(cleaned, "../") {
		return "", fmt.Errorf("translation bundle entry name is unsafe: %s", name)
	}
	return cleaned, nil
}
