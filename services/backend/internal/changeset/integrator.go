package changeset

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"

	"kernl.local/harness/backend/internal/domain"
)

type Write struct {
	Path           string
	ExpectedExists bool
	ExpectedSHA256 string
	ExpectedMode   os.FileMode
	ResultExists   bool
	Content        []byte
	Mode           os.FileMode
}

type Prepared struct {
	Outcome       domain.IntegrationOutcome
	Writes        []Write
	Conflicts     []domain.IntegrationConflictDetail
	SemanticFiles []string
	BarrierFiles  []string
}

type Journal struct {
	Outcome domain.IntegrationOutcome
	entries []journalEntry
}

type journalEntry struct {
	write    Write
	previous fileValue
}

type fileValue struct {
	exists bool
	data   []byte
	mode   os.FileMode
}

func Materialize(id, baseRevision, baseRoot, resultRoot string, paths []string) (domain.ChangeSet, error) {
	set := domain.ChangeSet{ID: id, BaseRevision: baseRevision, State: domain.IntegrationVerified}
	for _, path := range normalizedPaths(paths) {
		base, err := readFile(baseRoot, path)
		if err != nil {
			return domain.ChangeSet{}, err
		}
		result, err := readFile(resultRoot, path)
		if err != nil {
			return domain.ChangeSet{}, err
		}
		if sameFile(base, result) {
			continue
		}
		set.Mutations = append(set.Mutations, domain.FileMutation{
			Path: path, BaseSHA256: hashValue(base), ResultSHA256: hashValue(result),
			BaseExists: base.exists, ResultExists: result.exists,
			BaseContent: string(base.data), ResultContent: string(result.data),
			BaseMode: uint32(base.mode.Perm()), ResultMode: uint32(result.mode.Perm()),
		})
	}
	return set, nil
}

// SnapshotPaths creates a private minimal tree containing the current values of
// paths. Missing files remain absent so create/delete semantics are preserved.
func SnapshotPaths(root string, paths []string) (string, func(), error) {
	dir, err := os.MkdirTemp("", "wharness-changeset-base-*")
	if err != nil {
		return "", func() {}, err
	}
	cleanup := func() { _ = os.RemoveAll(dir) }
	for _, path := range normalizedPaths(paths) {
		value, readErr := readFile(root, path)
		if readErr != nil {
			cleanup()
			return "", func() {}, readErr
		}
		if value.exists {
			if writeErr := replaceFile(dir, path, true, value.data, value.mode); writeErr != nil {
				cleanup()
				return "", func() {}, writeErr
			}
		}
	}
	return dir, cleanup, nil
}

// ExtractArchive restores a trusted Wharness context archive into a private
// directory. Archive paths are still validated defensively.
func ExtractArchive(archivePath string) (string, func(), error) {
	reader, err := zip.OpenReader(archivePath)
	if err != nil {
		return "", func() {}, err
	}
	defer reader.Close()
	dir, err := os.MkdirTemp("", "wharness-task-base-*")
	if err != nil {
		return "", func() {}, err
	}
	cleanup := func() { _ = os.RemoveAll(dir) }
	for _, entry := range reader.File {
		path, pathErr := safePath(entry.Name)
		if pathErr != nil || entry.FileInfo().IsDir() {
			if pathErr != nil {
				cleanup()
				return "", func() {}, pathErr
			}
			continue
		}
		if entry.Mode()&os.ModeSymlink != 0 {
			cleanup()
			return "", func() {}, fmt.Errorf("symlink archive entry denied: %s", entry.Name)
		}
		input, openErr := entry.Open()
		if openErr != nil {
			cleanup()
			return "", func() {}, openErr
		}
		data := new(bytes.Buffer)
		_, copyErr := data.ReadFrom(input)
		closeErr := input.Close()
		if copyErr != nil || closeErr != nil {
			cleanup()
			if copyErr != nil {
				return "", func() {}, copyErr
			}
			return "", func() {}, closeErr
		}
		if writeErr := replaceFile(dir, path, true, data.Bytes(), entry.Mode().Perm()); writeErr != nil {
			cleanup()
			return "", func() {}, writeErr
		}
	}
	return dir, cleanup, nil
}

// Prepare reconciles ordered verified ChangeSets against root without mutating
// it. Later ChangeSets observe the virtual result of earlier ones.
func Prepare(root string, sets []domain.ChangeSet) (Prepared, error) {
	virtual := make(map[string]fileValue)
	expected := make(map[string]fileValue)
	order := make([]string, 0)
	seen := make(map[string]bool)
	conflicts := make([]domain.IntegrationConflictDetail, 0)

	for _, set := range sets {
		for _, mutation := range set.Mutations {
			path, err := safePath(mutation.Path)
			if err != nil {
				return Prepared{}, err
			}
			current, ok := virtual[path]
			if !ok {
				current, err = readFile(root, path)
				if err != nil {
					return Prepared{}, err
				}
				expected[path] = current
			}
			base := mutationBase(mutation)
			result := mutationResult(mutation)
			merged, reason, err := mergeValues(current, base, result)
			if err != nil {
				return Prepared{}, fmt.Errorf("merge %s: %w", path, err)
			}
			if reason != "" {
				conflicts = append(conflicts, domain.IntegrationConflictDetail{ChangeSetID: set.ID, Path: path, Reason: reason})
				continue
			}
			virtual[path] = merged
			if !seen[path] {
				seen[path] = true
				order = append(order, path)
			}
		}
	}
	if len(conflicts) > 0 {
		return Prepared{Outcome: domain.IntegrationConflict, Conflicts: conflicts}, nil
	}
	sort.Strings(order)
	prepared := Prepared{Outcome: domain.IntegrationReady}
	for _, set := range sets {
		for path, expectedHash := range set.ReadHashes {
			current, err := virtualValue(root, virtual, path)
			if err != nil {
				return Prepared{}, err
			}
			if hashValue(current) != expectedHash {
				prepared.SemanticFiles = append(prepared.SemanticFiles, path)
			}
		}
		for path, expectedHash := range set.BarrierHashes {
			current, err := virtualValue(root, virtual, path)
			if err != nil {
				return Prepared{}, err
			}
			if hashValue(current) != expectedHash {
				prepared.BarrierFiles = append(prepared.BarrierFiles, path)
			}
		}
	}
	prepared.SemanticFiles = normalizedPaths(prepared.SemanticFiles)
	prepared.BarrierFiles = normalizedPaths(prepared.BarrierFiles)
	for _, path := range order {
		before, after := expected[path], virtual[path]
		if sameFile(before, after) {
			continue
		}
		prepared.Writes = append(prepared.Writes, Write{
			Path: path, ExpectedExists: before.exists, ExpectedSHA256: hashValue(before),
			ExpectedMode: before.mode,
			ResultExists: after.exists, Content: append([]byte(nil), after.data...), Mode: after.mode,
		})
	}
	return prepared, nil
}

func FileHashes(root string, paths []string) (map[string]string, error) {
	result := make(map[string]string)
	for _, path := range normalizedPaths(paths) {
		value, err := readFile(root, path)
		if err != nil {
			return nil, err
		}
		result[path] = hashValue(value)
	}
	return result, nil
}

// ApplyToWorkspace writes a prepared candidate to an isolated workspace. It
// deliberately skips CAS because the workspace is private to this operation.
func ApplyToWorkspace(root string, prepared Prepared) error {
	if prepared.Outcome != domain.IntegrationReady {
		return fmt.Errorf("integration is not ready: %s", prepared.Outcome)
	}
	for _, write := range prepared.Writes {
		if err := replaceFile(root, write.Path, write.ResultExists, write.Content, write.Mode); err != nil {
			return err
		}
	}
	return nil
}

// Commit performs per-path compare-and-swap writes. Unexpected external values
// abort before overwrite; already-owned writes are rolled back conditionally.
func Commit(root string, prepared Prepared) (Journal, error) {
	journal := Journal{Outcome: domain.IntegrationIntegrated}
	if prepared.Outcome != domain.IntegrationReady {
		return journal, fmt.Errorf("integration is not ready: %s", prepared.Outcome)
	}
	for _, write := range prepared.Writes {
		current, err := readFile(root, write.Path)
		if err != nil {
			return rollback(root, journal, err)
		}
		if current.exists != write.ExpectedExists || hashValue(current) != write.ExpectedSHA256 || (current.exists && current.mode.Perm() != write.ExpectedMode.Perm()) {
			journal.Outcome = domain.IntegrationRetryableRace
			return rollback(root, journal, fmt.Errorf("external write race on %s", write.Path))
		}
		if err := replaceFile(root, write.Path, write.ResultExists, write.Content, write.Mode); err != nil {
			return rollback(root, journal, err)
		}
		journal.entries = append(journal.entries, journalEntry{write: write, previous: current})
	}
	return journal, nil
}

func (j Journal) Rollback(root string) error {
	_, err := rollback(root, j, errors.New("integration rollback requested"))
	if err != nil && err.Error() == "integration rollback requested" {
		return nil
	}
	return err
}

func rollback(root string, journal Journal, cause error) (Journal, error) {
	for index := len(journal.entries) - 1; index >= 0; index-- {
		entry := journal.entries[index]
		current, err := readFile(root, entry.write.Path)
		if err != nil {
			return journal, fmt.Errorf("%w; inspect rollback path %s: %v", cause, entry.write.Path, err)
		}
		result := fileValue{exists: entry.write.ResultExists, data: entry.write.Content, mode: entry.write.Mode}
		if !sameFile(current, result) {
			return journal, fmt.Errorf("%w; rollback refused external value at %s", cause, entry.write.Path)
		}
		if err := replaceFile(root, entry.write.Path, entry.previous.exists, entry.previous.data, entry.previous.mode); err != nil {
			return journal, fmt.Errorf("%w; rollback %s: %v", cause, entry.write.Path, err)
		}
	}
	return journal, cause
}

func mergeValues(current, base, result fileValue) (fileValue, string, error) {
	if sameFile(current, base) {
		return result, "", nil
	}
	if sameFile(result, base) || sameFile(current, result) {
		return current, "", nil
	}
	if !base.exists || !current.exists || !result.exists {
		return fileValue{}, "create/delete conflict", nil
	}
	if bytes.IndexByte(base.data, 0) >= 0 || bytes.IndexByte(current.data, 0) >= 0 || bytes.IndexByte(result.data, 0) >= 0 {
		return fileValue{}, "binary content conflict", nil
	}
	merged, clean, err := mergeText(current.data, base.data, result.data)
	if err != nil {
		return fileValue{}, "", err
	}
	if !clean {
		return fileValue{}, "overlapping text edits", nil
	}
	if current.mode.Perm() != base.mode.Perm() && result.mode.Perm() != base.mode.Perm() && current.mode.Perm() != result.mode.Perm() {
		return fileValue{}, "file mode conflict", nil
	}
	mode := current.mode
	if result.mode.Perm() != base.mode.Perm() {
		mode = result.mode
	}
	return fileValue{exists: true, data: merged, mode: mode}, "", nil
}

func mergeText(current, base, result []byte) ([]byte, bool, error) {
	dir, err := os.MkdirTemp("", "wharness-merge-*")
	if err != nil {
		return nil, false, err
	}
	defer os.RemoveAll(dir)
	paths := []string{filepath.Join(dir, "current"), filepath.Join(dir, "base"), filepath.Join(dir, "result")}
	for index, data := range [][]byte{current, base, result} {
		if err := os.WriteFile(paths[index], data, 0o600); err != nil {
			return nil, false, err
		}
	}
	cmd := exec.Command("git", "merge-file", "-p", paths[0], paths[1], paths[2])
	output, runErr := cmd.Output()
	if runErr == nil {
		return output, true, nil
	}
	var exitErr *exec.ExitError
	if errors.As(runErr, &exitErr) && exitErr.ExitCode() == 1 {
		return nil, false, nil
	}
	return nil, false, runErr
}

func mutationBase(m domain.FileMutation) fileValue {
	return fileValue{exists: m.BaseExists, data: []byte(m.BaseContent), mode: os.FileMode(m.BaseMode)}
}

func mutationResult(m domain.FileMutation) fileValue {
	return fileValue{exists: m.ResultExists, data: []byte(m.ResultContent), mode: os.FileMode(m.ResultMode)}
}

func readFile(root, relative string) (fileValue, error) {
	path, err := containedPath(root, relative)
	if err != nil {
		return fileValue{}, err
	}
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return fileValue{}, nil
	}
	if err != nil {
		return fileValue{}, err
	}
	if !info.Mode().IsRegular() {
		return fileValue{}, fmt.Errorf("non-regular integration path denied: %s", relative)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return fileValue{}, err
	}
	return fileValue{exists: true, data: data, mode: info.Mode().Perm()}, nil
}

func replaceFile(root, relative string, exists bool, data []byte, mode os.FileMode) error {
	path, err := containedPath(root, relative)
	if err != nil {
		return err
	}
	if !exists {
		if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		return nil
	}
	if mode.Perm() == 0 {
		mode = 0o600
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".wharness-write-*")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)
	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Chmod(mode.Perm()); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmpPath, path)
}

func containedPath(root, relative string) (string, error) {
	clean, err := safePath(relative)
	if err != nil {
		return "", err
	}
	root, err = filepath.Abs(root)
	if err != nil {
		return "", err
	}
	path := filepath.Join(root, filepath.FromSlash(clean))
	parent := filepath.Dir(path)
	for parent != root && parent != filepath.Dir(parent) {
		info, statErr := os.Lstat(parent)
		if statErr == nil && info.Mode()&os.ModeSymlink != 0 {
			return "", fmt.Errorf("symlink parent denied: %s", relative)
		}
		if statErr != nil && !errors.Is(statErr, os.ErrNotExist) {
			return "", statErr
		}
		parent = filepath.Dir(parent)
	}
	return path, nil
}

func safePath(value string) (string, error) {
	value = filepath.ToSlash(filepath.Clean(strings.TrimSpace(value)))
	if value == "" || value == "." || value == ".." || strings.HasPrefix(value, "../") || filepath.IsAbs(value) {
		return "", fmt.Errorf("integration path escapes project: %s", value)
	}
	return value, nil
}

func normalizedPaths(values []string) []string {
	seen := make(map[string]bool)
	result := make([]string, 0, len(values))
	for _, value := range values {
		clean, err := safePath(value)
		if err == nil && !seen[clean] {
			seen[clean] = true
			result = append(result, clean)
		}
	}
	sort.Strings(result)
	return result
}

func virtualValue(root string, virtual map[string]fileValue, path string) (fileValue, error) {
	clean, err := safePath(path)
	if err != nil {
		return fileValue{}, err
	}
	if value, ok := virtual[clean]; ok {
		return value, nil
	}
	return readFile(root, clean)
}

func hashValue(value fileValue) string {
	if !value.exists {
		return ""
	}
	sum := sha256.Sum256(value.data)
	return hex.EncodeToString(sum[:])
}

func sameFile(left, right fileValue) bool {
	return left.exists == right.exists && (!left.exists || (bytes.Equal(left.data, right.data) && left.mode.Perm() == right.mode.Perm()))
}
