package releasenotes

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

func ParseResult(filename string, raw []byte, request TransportManifest) (Result, error) {
	expectedName, err := ResultFilename(request.TaskID)
	if err != nil {
		return Result{}, err
	}
	if path.Base(strings.TrimSpace(filename)) != expectedName {
		return Result{}, fmt.Errorf("release-notes bundle filename %q is not %q", filename, expectedName)
	}
	if len(raw) == 0 || len(raw) > MaxBundleBytes {
		return Result{}, fmt.Errorf("release-notes bundle size must be within %d bytes", MaxBundleBytes)
	}
	files, err := readArchive(raw)
	if err != nil {
		return Result{}, err
	}
	if len(files) != 2 {
		return Result{}, fmt.Errorf("release-notes bundle must contain exactly two files")
	}
	manifestBytes, ok := files[ResultManifestPath]
	if !ok {
		return Result{}, fmt.Errorf("release-notes bundle is missing %s", ResultManifestPath)
	}
	var manifest ResultManifest
	decoder := json.NewDecoder(bytes.NewReader(manifestBytes))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&manifest); err != nil {
		return Result{}, fmt.Errorf("decode %s: %w", ResultManifestPath, err)
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return Result{}, fmt.Errorf("%s contains trailing JSON", ResultManifestPath)
	}
	if manifest.Protocol != ResultProtocolV1 || manifest.Task != TaskGenerate {
		return Result{}, fmt.Errorf("release-notes bundle has an unsupported protocol or task")
	}
	if strings.TrimSpace(manifest.TaskID) != request.TaskID || strings.TrimSpace(manifest.Branch) != request.Branch {
		return Result{}, fmt.Errorf("release-notes bundle answers a different request")
	}
	if !strings.EqualFold(strings.TrimSpace(manifest.SourceSHA256), request.SourceSHA256) {
		return Result{}, fmt.Errorf("release-notes bundle declares a different source")
	}
	if strings.TrimSpace(manifest.ResultPath) != request.ResultPath {
		return Result{}, fmt.Errorf("release-notes bundle declares an unexpected result path")
	}
	body, ok := files[request.ResultPath]
	if !ok || len(body) == 0 || len(body) > MaxResultBytes || !utf8.Valid(body) {
		return Result{}, fmt.Errorf("release-notes bundle contains an invalid %s", request.ResultPath)
	}
	if strings.TrimSpace(string(body)) == "" {
		return Result{}, fmt.Errorf("release-notes bundle delivered empty notes")
	}
	return Result{TaskID: request.TaskID, Branch: request.Branch, Body: strings.TrimSpace(string(body))}, nil
}

func readArchive(raw []byte) (map[string][]byte, error) {
	reader, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		return nil, fmt.Errorf("open release-notes bundle zip: %w", err)
	}
	if len(reader.File) == 0 || len(reader.File) > maxEntries {
		return nil, fmt.Errorf("release-notes bundle must contain 1..%d entries", maxEntries)
	}
	files := make(map[string][]byte, len(reader.File))
	var expanded int64
	for _, entry := range reader.File {
		name, nameErr := safeName(entry.Name)
		if nameErr != nil {
			return nil, nameErr
		}
		if entry.FileInfo().IsDir() || entry.FileInfo().Mode()&0o170000 == 0o120000 {
			return nil, fmt.Errorf("release-notes bundle entry is not a regular file: %s", name)
		}
		expanded += int64(entry.UncompressedSize64)
		if expanded > maxExpandedBytes {
			return nil, fmt.Errorf("release-notes bundle expanded size exceeds %d bytes", maxExpandedBytes)
		}
		rc, openErr := entry.Open()
		if openErr != nil {
			return nil, fmt.Errorf("open release-notes bundle entry %s: %w", name, openErr)
		}
		data, readErr := io.ReadAll(io.LimitReader(rc, maxExpandedBytes+1))
		_ = rc.Close()
		if readErr != nil {
			return nil, fmt.Errorf("read release-notes bundle entry %s: %w", name, readErr)
		}
		if _, duplicate := files[name]; duplicate {
			return nil, fmt.Errorf("duplicate release-notes bundle entry: %s", name)
		}
		files[name] = data
	}
	return files, nil
}

func safeName(name string) (string, error) {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" || strings.ContainsRune(trimmed, '\\') || strings.HasPrefix(trimmed, "/") {
		return "", fmt.Errorf("release-notes bundle entry name is unsafe: %s", name)
	}
	cleaned := path.Clean(trimmed)
	if cleaned != trimmed || cleaned == "." || cleaned == ".." || strings.HasPrefix(cleaned, "../") {
		return "", fmt.Errorf("release-notes bundle entry name is unsafe: %s", name)
	}
	return cleaned, nil
}
