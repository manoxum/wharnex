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

// ErrTransactionMetadataMismatch marks retained self-evolution state whose
// transaction.json identity disagrees with the transaction referenced by status.
var ErrTransactionMetadataMismatch = errors.New("self-evolution transaction metadata does not match transaction")

type transactionMetadata struct {
	TransactionID     string        `json:"transaction_id"`
	Root              string        `json:"root"`
	Plans             []PendingPlan `json:"plans"`
	ActivationImpacts []string      `json:"activation_impacts"`
	// PreTransactionSHA is the host's real Git HEAD at the moment this
	// transaction captured its source-file backups, when the host is a Git
	// repository. Rollback compares this against HEAD at rollback time to
	// detect an unrelated integration merge that landed on top of it — see
	// Transaction.Rollback.
	PreTransactionSHA string `json:"pre_transaction_sha,omitempty"`
}

var buildGuardPaths = []string{
	"services/backend/go.mod",
	"services/backend/go.sum",
	"services/frontend/package.json",
	"services/frontend/package-lock.json",
	"services/webapp/package.json",
	"services/webapp/package-lock.json",
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
		{filepath.Join(tx.Root, "services", "webapp", "dist"), filepath.Join(runtimeDir, "webapp-dist")},
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
	fingerprint := filepath.Join(tx.Root, ".harness", "source-success.sha256")
	if info, err := os.Stat(fingerprint); err == nil && info.Mode().IsRegular() {
		if err := copyFile(fingerprint, filepath.Join(runtimeDir, "source-success.sha256"), info.Mode()); err != nil {
			return err
		}
	}
	return nil
}

func (tx Transaction) captureLifecycleScripts() error {
	destinations := map[string]string{
		"self-restart.sh": "worker.sh",
		"start.sh":        "start-known-good.sh",
		"stop.sh":         "stop-known-good.sh",
		"stack.sh":        "stack-known-good.sh",
	}
	for _, name := range []string{"self-restart.sh", "start.sh", "stop.sh", "stack.sh"} {
		source := filepath.Join(tx.Root, "scripts", name)
		_, err := os.Stat(source)
		if err != nil {
			return fmt.Errorf("self-evolution lifecycle script %s unavailable: %w", name, err)
		}
		destination := filepath.Join(tx.Dir, destinations[name])
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
		TransactionID:     tx.ID,
		Root:              tx.Root,
		Plans:             []PendingPlan{{SessionID: sessionID, PlanID: planID}},
		ActivationImpacts: append([]string{}, tx.ActivationImpacts...),
		PreTransactionSHA: tx.PreTransactionSHA,
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
	metadata.ActivationImpacts = mergeActivationImpacts(metadata.ActivationImpacts, tx.ActivationImpacts)
	return tx.saveMetadata(metadata)
}

func activationImpacts(patches []string) []string {
	impacts := map[string]struct{}{}
	for _, patch := range patches {
		for _, path := range patchPaths(patch) {
			switch {
			case strings.HasPrefix(path, "services/backend/"), strings.HasPrefix(path, "schemas/"):
				impacts["backend"] = struct{}{}
			case strings.HasPrefix(path, "services/frontend/"):
				impacts["frontend"] = struct{}{}
			case strings.HasPrefix(path, "services/webapp/"):
				impacts["webapp"] = struct{}{}
			case strings.HasPrefix(path, "services/gateway/"):
				impacts["gateway"] = struct{}{}
			case strings.HasPrefix(path, "services/desktop/"):
				impacts["desktop"] = struct{}{}
			case strings.HasPrefix(path, "services/tunnel/"):
				impacts["tunnel"] = struct{}{}
			case path == "compose.yml", strings.HasPrefix(path, "docker/"):
				impacts["backend"] = struct{}{}
				impacts["frontend"] = struct{}{}
				impacts["webapp"] = struct{}{}
				impacts["gateway"] = struct{}{}
				impacts["tunnel"] = struct{}{}
			}
		}
	}
	return uniqueSorted(impacts)
}

func mergeActivationImpacts(groups ...[]string) []string {
	merged := map[string]struct{}{}
	for _, group := range groups {
		for _, impact := range group {
			merged[impact] = struct{}{}
		}
	}
	return uniqueSorted(merged)
}

// RemoveExtensionPlan rolls back only the membership appended while preparing
// an extension that failed before any host mutation. Source backups captured
// for new paths are intentionally retained: they still describe the original
// batch baseline and are safe/useful if a later extension touches those paths.
func (tx Transaction) RemoveExtensionPlan(sessionID, planID string) error {
	if !tx.Extended || !tx.ExtensionAddedPlan {
		return nil
	}
	metadata, err := tx.readMetadata()
	if err != nil {
		return err
	}
	kept := metadata.Plans[:0]
	for _, pending := range metadata.Plans {
		if pending.SessionID == sessionID && pending.PlanID == planID {
			continue
		}
		kept = append(kept, pending)
	}
	metadata.Plans = kept
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
	metadata, err := tx.readMetadataUnchecked()
	if err != nil {
		return transactionMetadata{}, err
	}
	if metadata.TransactionID != tx.ID || metadata.Root != tx.Root {
		return transactionMetadata{}, fmt.Errorf("%w: metadata transaction=%s root=%s, expected transaction=%s root=%s", ErrTransactionMetadataMismatch, metadata.TransactionID, metadata.Root, tx.ID, tx.Root)
	}
	return metadata, nil
}

func (tx Transaction) readMetadataUnchecked() (transactionMetadata, error) {
	data, err := os.ReadFile(filepath.Join(tx.Dir, "transaction.json"))
	if err != nil {
		return transactionMetadata{}, err
	}
	var metadata transactionMetadata
	if err := json.Unmarshal(data, &metadata); err != nil {
		return transactionMetadata{}, fmt.Errorf("read self-evolution transaction metadata: %w", err)
	}
	return metadata, nil
}

func (tx Transaction) saveMetadata(metadata transactionMetadata) error {
	raw, err := json.MarshalIndent(metadata, "", "  ")
	if err != nil {
		return err
	}
	temp, err := os.CreateTemp(tx.Dir, ".transaction-*.json")
	if err != nil {
		return err
	}
	tempPath := temp.Name()
	defer os.Remove(tempPath)
	if err := temp.Chmod(0o600); err != nil {
		_ = temp.Close()
		return err
	}
	if _, err := temp.Write(append(raw, '\n')); err != nil {
		_ = temp.Close()
		return err
	}
	if err := temp.Sync(); err != nil {
		_ = temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	return os.Rename(tempPath, filepath.Join(tx.Dir, "transaction.json"))
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
	script.WriteString("rm -rf \"$ROOT/dist\" \"$ROOT/services/frontend/dist\" \"$ROOT/services/webapp/dist\"\n")
	script.WriteString("[ ! -d \"$TXN/runtime/root-dist\" ] || cp -a \"$TXN/runtime/root-dist\" \"$ROOT/dist\"\n")
	script.WriteString("[ ! -d \"$TXN/runtime/frontend-dist\" ] || cp -a \"$TXN/runtime/frontend-dist\" \"$ROOT/services/frontend/dist\"\n")
	script.WriteString("[ ! -d \"$TXN/runtime/webapp-dist\" ] || cp -a \"$TXN/runtime/webapp-dist\" \"$ROOT/services/webapp/dist\"\n")
	script.WriteString("if [ -f \"$TXN/runtime/build-success\" ]; then mkdir -p \"$ROOT/.harness\"; cp -p \"$TXN/runtime/build-success\" \"$ROOT/.harness/build-success\"; touch \"$ROOT/.harness/build-success\"; else rm -f \"$ROOT/.harness/build-success\"; fi\n")
	script.WriteString("if [ -f \"$TXN/runtime/source-success.sha256\" ]; then cp -p \"$TXN/runtime/source-success.sha256\" \"$ROOT/.harness/source-success.sha256\"; else rm -f \"$ROOT/.harness/source-success.sha256\"; fi\n")
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
