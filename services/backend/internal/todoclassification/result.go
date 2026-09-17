package todoclassification

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"path"
	"strings"
)

func ParseResult(filename string, bundle []byte, request TransportManifest) (Result, error) {
	expected, err := ResultFilename(request.TaskID)
	if err != nil {
		return Result{}, err
	}
	if filename != expected {
		return Result{}, fmt.Errorf("TODO classification bundle filename %q is not %q", filename, expected)
	}
	if len(bundle) == 0 || len(bundle) > MaxBundleBytes {
		return Result{}, fmt.Errorf("TODO classification bundle exceeds the transport limit")
	}
	reader, err := zip.NewReader(bytes.NewReader(bundle), int64(len(bundle)))
	if err != nil {
		return Result{}, fmt.Errorf("open TODO classification bundle: %w", err)
	}
	if len(reader.File) != 1 {
		return Result{}, fmt.Errorf("TODO classification bundle must contain exactly one entry")
	}
	entry := reader.File[0]
	name := strings.ReplaceAll(entry.Name, "\\", "/")
	if name != ResultPath || path.Clean(name) != name || entry.FileInfo().IsDir() || entry.Mode()&0o120000 != 0 {
		return Result{}, fmt.Errorf("TODO classification bundle has an invalid result entry")
	}
	if entry.UncompressedSize64 > MaxBundleBytes {
		return Result{}, fmt.Errorf("TODO classification result is too large")
	}
	opened, err := entry.Open()
	if err != nil {
		return Result{}, fmt.Errorf("open TODO classification result: %w", err)
	}
	defer opened.Close()
	raw, err := io.ReadAll(io.LimitReader(opened, MaxBundleBytes+1))
	if err != nil || len(raw) > MaxBundleBytes {
		return Result{}, fmt.Errorf("read TODO classification result")
	}
	var result Result
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&result); err != nil {
		return Result{}, fmt.Errorf("decode TODO classification result: %w", err)
	}
	if result.Protocol != ResultProtocolV1 || result.Task != TaskClassifyTodo || result.TaskID != request.TaskID || result.TodoID != request.TodoID || result.SourceSHA256 != request.SourceSHA256 {
		return Result{}, fmt.Errorf("TODO classification result does not match its request")
	}
	if !validKind(result.Kind) || !validUrgency(result.Urgency) {
		return Result{}, fmt.Errorf("TODO classification result contains an unsupported classification")
	}
	return result, nil
}
