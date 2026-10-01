package gitlive

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"kernl.local/harness/backend/internal/hostrepo"
)

// Snapshot fingerprints the Git state shown by the project UI. Only digests
// cross the stream boundary; paths, diff text, and local contents stay here.
// A failed repository is omitted and retried on the next sample.
func Snapshot(ctx context.Context, projectPath string) (map[string][32]byte, error) {
	units, err := hostrepo.InspectUnits(ctx, projectPath)
	if err != nil {
		return nil, fmt.Errorf("inspect Git repositories: %w", err)
	}
	signatures := make(map[string][32]byte, len(units.List))
	for _, unit := range units.List {
		if !unit.Integrable() {
			continue
		}
		working, err := hostrepo.Working(ctx, unit.Root)
		if err != nil {
			continue
		}
		branches, err := hostrepo.Branches(ctx, unit.Root)
		if err != nil {
			continue
		}
		tags, err := hostrepo.Tags(ctx, unit.Root, 50)
		if err != nil {
			continue
		}
		head, _ := hostrepo.HeadSHA(ctx, unit.Root)
		payload, err := json.Marshal(struct {
			Head     string
			Branch   string
			Working  hostrepo.WorkingState
			Files    map[string]fileStamp
			Staged   [32]byte
			Branches any
			Tags     any
		}{head, unit.Topology.Branch, working, changedFileStamps(unit.Root, working), hostrepo.StagedSignature(ctx, unit.Root), branches, tags})
		if err == nil {
			signatures[unit.Path] = sha256.Sum256(payload)
		}
	}
	return signatures, nil
}

type fileStamp struct {
	Size     int64
	Modified int64
	Mode     os.FileMode
}

func stamp(path string) fileStamp {
	info, err := os.Lstat(path)
	if err != nil {
		return fileStamp{}
	}
	return fileStamp{Size: info.Size(), Modified: info.ModTime().UnixNano(), Mode: info.Mode()}
}

func changedFileStamps(root string, working hostrepo.WorkingState) map[string]fileStamp {
	files := make(map[string]fileStamp, len(working.Statuses))
	for path := range working.Statuses {
		files[path] = stamp(filepath.Join(root, filepath.FromSlash(path)))
	}
	return files
}

// Changed reports only repositories whose state appeared or changed. A
// removed repository invalidates the root inventory as well.
func Changed(before, after map[string][32]byte) []string {
	var changed []string
	for path, signature := range after {
		if previous, ok := before[path]; !ok || previous != signature {
			changed = append(changed, path)
		}
	}
	for path := range before {
		if _, ok := after[path]; !ok {
			changed = append(changed, path)
		}
	}
	return changed
}
