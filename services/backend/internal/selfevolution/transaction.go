package selfevolution

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

type sourceBackup struct {
	Path    string `json:"path"`
	Existed bool   `json:"existed"`
	Backup  string `json:"backup,omitempty"`
	Mode    uint32 `json:"mode,omitempty"`
}

type transactionMetadata struct {
	TransactionID string        `json:"transaction_id"`
	Root          string        `json:"root"`
	Plans         []PendingPlan `json:"plans"`
}

var buildGuardPaths = []string{
	"services/backend/go.mod",
	"services/backend/go.sum",
	"services/frontend/package.json",
	"services/frontend/package-lock.json",
	"services/desktop/package.json",
	"services/desktop/package-lock.json",
}

func (tx Transaction) captureSource(patches []string) error {
	paths := map[string]struct{}{}
	for _, patch := range patches {
		for _, path := range patchPaths(patch) {
			if runtimeOwnedPath(path) {
				return fmt.Errorf("self-evolution refuses runtime-owned path %s", path)
			}
			paths[path] = struct{}{}
		}
	}
	if len(paths) == 0 {
		return errors.New("self-evolution patch did not expose any file paths")
	}
	for _, path := range buildGuardPaths {
		paths[path] = struct{}{}
	}
	backups, err := tx.readSourceBackups()
	if err != nil {
		return err
	}
	known := make(map[string]struct{}, len(backups))
	for _, backup := range backups {
		known[backup.Path] = struct{}{}
	}
	nextIndex := len(backups)
	for _, relative := range uniqueSorted(paths) {
		if _, exists := known[relative]; exists {
			continue
		}
		absolute, err := containedPath(tx.Root, relative)
		if err != nil {
			return err
		}
		info, err := os.Lstat(absolute)
		if errors.Is(err, os.ErrNotExist) {
			backups = append(backups, sourceBackup{Path: relative})
			known[relative] = struct{}{}
			continue
		}
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return fmt.Errorf("self-evolution refuses non-regular target %s", relative)
		}
		backupName := fmt.Sprintf("source/%04d.bin", nextIndex)
		nextIndex++
		if err := copyFile(absolute, filepath.Join(tx.Dir, backupName), info.Mode()); err != nil {
			return fmt.Errorf("backup %s: %w", relative, err)
		}
		backups = append(backups, sourceBackup{Path: relative, Existed: true, Backup: backupName, Mode: uint32(info.Mode().Perm())})
		known[relative] = struct{}{}
	}
	sort.Slice(backups, func(i, j int) bool { return backups[i].Path < backups[j].Path })
	data, err := json.MarshalIndent(backups, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(tx.Dir, "source-backup.json"), append(data, '\n'), 0o600); err != nil {
		return err
	}
	return tx.writeRollback(backups)
}

func (tx Transaction) readSourceBackups() ([]sourceBackup, error) {
	data, err := os.ReadFile(filepath.Join(tx.Dir, "source-backup.json"))
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var backups []sourceBackup
	if err := json.Unmarshal(data, &backups); err != nil {
		return nil, fmt.Errorf("read self-evolution source backup metadata: %w", err)
	}
	return backups, nil
}

func (tx Transaction) captureRuntime() error {
	runtimeDir := filepath.Join(tx.Dir, "runtime")
	if err := os.MkdirAll(runtimeDir, 0o700); err != nil {
		return err
	}
	for _, item := range []struct{ source, destination string }{
		{filepath.Join(tx.Root, "dist"), filepath.Join(runtimeDir, "root-dist")},
		{filepath.Join(tx.Root, "services", "frontend", "dist"), filepath.Join(runtimeDir, "frontend-dist")},
	} {
		if stat, err := os.Stat(item.source); err == nil && stat.IsDir() {
			if output, err := exec.Command("cp", "-a", item.source, item.destination).CombinedOutput(); err != nil {
				return fmt.Errorf("backup runtime artifacts: %w: %s", err, strings.TrimSpace(string(output)))
			}
		}
	}
	stamp := filepath.Join(tx.Root, ".harness", "build-success")
	if info, err := os.Stat(stamp); err == nil && info.Mode().IsRegular() {
		if err := copyFile(stamp, filepath.Join(runtimeDir, "build-success"), info.Mode()); err != nil {
			return err
		}
	}
	return nil
}

func (tx Transaction) captureLifecycleScripts() error {
	for _, name := range []string{"self-restart.sh", "start.sh", "stop.sh"} {
		source := filepath.Join(tx.Root, "scripts", name)
		_, err := os.Stat(source)
		if err != nil {
			return fmt.Errorf("self-evolution lifecycle script %s unavailable: %w", name, err)
		}
		destination := filepath.Join(tx.Dir, map[string]string{"self-restart.sh": "worker.sh", "start.sh": "start-known-good.sh", "stop.sh": "stop-known-good.sh"}[name])
		if err := copyFile(source, destination, 0o700); err != nil {
			return err
		}
		if err := os.Chmod(destination, 0o700); err != nil {
			return err
		}
	}
	return nil
}

func (tx Transaction) writeMetadata(sessionID, planID string) error {
	metadata := transactionMetadata{
		TransactionID: tx.ID,
		Root:          tx.Root,
		Plans:         []PendingPlan{{SessionID: sessionID, PlanID: planID}},
	}
	return tx.saveMetadata(metadata)
}

func (tx Transaction) appendPendingPlan(sessionID, planID string) error {
	metadata, err := tx.readMetadata()
	if err != nil {
		return err
	}
	for _, pending := range metadata.Plans {
		if pending.SessionID == sessionID && pending.PlanID == planID {
			return nil
		}
	}
	metadata.Plans = append(metadata.Plans, PendingPlan{SessionID: sessionID, PlanID: planID})
	return tx.saveMetadata(metadata)
}

func (tx Transaction) PendingPlans() ([]PendingPlan, error) {
	metadata, err := tx.readMetadata()
	if err != nil {
		return nil, err
	}
	return append([]PendingPlan(nil), metadata.Plans...), nil
}

func (tx Transaction) readMetadata() (transactionMetadata, error) {
	data, err := os.ReadFile(filepath.Join(tx.Dir, "transaction.json"))
	if err != nil {
		return transactionMetadata{}, err
	}
	var metadata transactionMetadata
	if err := json.Unmarshal(data, &metadata); err != nil {
		return transactionMetadata{}, fmt.Errorf("read self-evolution transaction metadata: %w", err)
	}
	if metadata.TransactionID != tx.ID || metadata.Root != tx.Root {
		return transactionMetadata{}, errors.New("self-evolution transaction metadata does not match transaction")
	}
	return metadata, nil
}

func (tx Transaction) saveMetadata(metadata transactionMetadata) error {
	raw, err := json.MarshalIndent(metadata, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(tx.Dir, "transaction.json"), append(raw, '\n'), 0o600)
}

func (tx Transaction) writeRollback(backups []sourceBackup) error {
	var script strings.Builder
	script.WriteString("#!/usr/bin/env sh\nset -eu\nROOT=$1\nTXN=$2\n")
	script.WriteString("case \"$TXN\" in \"$ROOT\"/.harness/self-evolution/txn-*) ;; *) echo 'invalid self-evolution transaction path' >&2; exit 2;; esac\n")
	for _, backup := range backups {
		destination := shellVarPath("ROOT", backup.Path)
		if backup.Existed {
			script.WriteString("mkdir -p ")
			script.WriteString(shellVarPath("ROOT", filepath.Dir(backup.Path)))
			script.WriteString("\ncp -p ")
			script.WriteString(shellVarPath("TXN", backup.Backup))
			script.WriteString(" ")
			script.WriteString(destination)
			script.WriteString("\nchmod ")
			script.WriteString(strconv.FormatUint(uint64(backup.Mode), 8))
			script.WriteString(" ")
			script.WriteString(destination)
			script.WriteString("\n")
		} else {
			script.WriteString("rm -f ")
			script.WriteString(destination)
			script.WriteString("\n")
		}
	}
	script.WriteString("rm -rf \"$ROOT/dist\" \"$ROOT/services/frontend/dist\"\n")
	script.WriteString("[ ! -d \"$TXN/runtime/root-dist\" ] || cp -a \"$TXN/runtime/root-dist\" \"$ROOT/dist\"\n")
	script.WriteString("[ ! -d \"$TXN/runtime/frontend-dist\" ] || cp -a \"$TXN/runtime/frontend-dist\" \"$ROOT/services/frontend/dist\"\n")
	script.WriteString("if [ -f \"$TXN/runtime/build-success\" ]; then mkdir -p \"$ROOT/.harness\"; cp -p \"$TXN/runtime/build-success\" \"$ROOT/.harness/build-success\"; touch \"$ROOT/.harness/build-success\"; else rm -f \"$ROOT/.harness/build-success\"; fi\n")
	if err := os.WriteFile(tx.RollbackScript, []byte(script.String()), 0o700); err != nil {
		return err
	}
	return os.Chmod(tx.RollbackScript, 0o700)
}

func shellVarPath(variable, relative string) string {
	return "\"$" + variable + "/\"" + shellLiteral(relative)
}

func shellLiteral(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "'\"'\"'") + "'"
}

func patchPaths(patch string) []string {
	paths := map[string]struct{}{}
	add := func(value string) {
		value = strings.TrimSpace(value)
		if fields := strings.Fields(value); len(fields) > 0 {
			value = fields[0]
		}
		if value == "" || value == "/dev/null" {
			return
		}
		value = strings.TrimPrefix(value, "a/")
		value = strings.TrimPrefix(value, "b/")
		value = filepath.Clean(value)
		if value != "." && value != ".." && !filepath.IsAbs(value) && !strings.HasPrefix(value, ".."+string(filepath.Separator)) {
			paths[value] = struct{}{}
		}
	}
	for _, line := range strings.Split(patch, "\n") {
		switch {
		case strings.HasPrefix(line, "diff --git "):
			fields := strings.Fields(strings.TrimPrefix(line, "diff --git "))
			if len(fields) == 2 {
				add(fields[0])
				add(fields[1])
			}
		case strings.HasPrefix(line, "--- "), strings.HasPrefix(line, "+++ "):
			add(line[4:])
		case strings.HasPrefix(line, "rename from "):
			add(strings.TrimPrefix(line, "rename from "))
		case strings.HasPrefix(line, "rename to "):
			add(strings.TrimPrefix(line, "rename to "))
		case strings.HasPrefix(line, "copy from "):
			add(strings.TrimPrefix(line, "copy from "))
		case strings.HasPrefix(line, "copy to "):
			add(strings.TrimPrefix(line, "copy to "))
		}
	}
	return uniqueSorted(paths)
}

func runtimeOwnedPath(relative string) bool {
	relative = filepath.ToSlash(filepath.Clean(relative))
	return relative == ".harness" || strings.HasPrefix(relative, ".harness/")
}

func containedPath(root, relative string) (string, error) {
	if strings.ContainsAny(relative, "\x00\r\n") {
		return "", errors.New("unsafe self-evolution path")
	}
	absolute := filepath.Join(root, relative)
	rel, err := filepath.Rel(root, absolute)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("self-evolution path escapes root: %s", relative)
	}
	return absolute, nil
}
