package planner

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"kernl.local/harness/backend/internal/domain"
)

// The prompt embeds the context manifest so the planner can resolve every path
// it intends to touch. That inventory grows with the project and had no bound,
// while the Desktop refuses to hand ChatGPT a prompt larger than 1 MiB — a hard
// throw at the very last step, after the request was planned and the context
// built.
//
// Production evidence: a 14,468-file project produced a 5.8 MiB prompt, so
// every send in that project failed with "Prepared prompt exceeds 1 MiB limit"
// and none of its chats ever bound to a conversation. The same instance's own
// repository was at 862 KiB — 84% of the cap — so this was days from breaking
// there too.
//
// Pruning dependency stores shrinks the common case; it cannot bound the
// general one. A large repository of genuine source will exceed any per-prompt
// budget eventually, so the inventory is bounded by construction here.

// manifestPromptBudget is how many bytes of rendered manifest the prompt will
// carry. The Desktop's limit applies to the whole prompt, and the instructions,
// the user's message and the knowledge section share it, so this deliberately
// leaves most of the megabyte to them.
const manifestPromptBudget = 384 * 1024

// renderContextManifest returns the manifest as the prompt should carry it. The
// complete inventory is used whenever it fits; otherwise the file list is
// truncated and the result says exactly how many entries were dropped and where
// the complete inventory still lives.
//
// Truncation is always declared. A silently shortened inventory would invite
// the planner to conclude a file does not exist and write it again from
// scratch, which is worse than being told the list is partial.
func renderContextManifest(manifest domain.ContextManifest) string {
	// Structured exclusion details exist for local audit/UI inspection. The
	// legacy exclusion summary is sufficient for the model and avoids sending
	// the same exclusion inventory twice.
	manifest.ExcludedDetails = nil

	if rendered, ok := marshalManifest(manifest); ok && len(rendered) <= manifestPromptBudget {
		return rendered
	}

	total := len(manifest.Files)
	kept := manifestFilesWithinBudget(manifest)
	omitted := total - len(kept)
	if omitted <= 0 {
		// The overflow is not the file list (a huge exclusion summary, say).
		// Carrying it whole is still better than inventing a truncation that
		// does not describe what actually overflowed.
		rendered, _ := marshalManifest(manifest)
		return rendered
	}
	manifest.Files = kept
	rendered, _ := marshalManifest(manifest)
	return fmt.Sprintf(`%s

NOTE — this inventory is TRUNCATED. It lists %d of %d files; %d entries were omitted to keep this prompt within the size the transport accepts. The attached context bundle carries the complete set, and %s is the authoritative manifest identity. Absence from the list above is NOT evidence that a file does not exist: when a path you need is missing here, say so in turn.message instead of recreating the file.`,
		rendered, len(kept), total, omitted, manifest.SHA256)
}

// marshalManifest renders the manifest exactly as the prompt carries it.
func marshalManifest(manifest domain.ContextManifest) (string, bool) {
	encoded, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return "", false
	}
	return string(encoded), true
}

// manifestFilesWithinBudget picks the files to keep when the whole inventory
// does not fit. Selection is deterministic and shallow-first: a path closer to
// the repository root is more likely to be the code a request is about than one
// buried deep inside a generated or vendored tree, and ties break
// alphabetically so the same project always yields the same prompt.
func manifestFilesWithinBudget(manifest domain.ContextManifest) []domain.ContextFile {
	ordered := append([]domain.ContextFile(nil), manifest.Files...)
	sort.SliceStable(ordered, func(i, j int) bool {
		left, right := pathDepth(ordered[i].Path), pathDepth(ordered[j].Path)
		if left != right {
			return left < right
		}
		return ordered[i].Path < ordered[j].Path
	})

	// Measure the manifest with no files at all, then add entries while the
	// rendered result still fits. Rendering once per candidate would be O(n²)
	// on a 14k-file project, so the per-entry cost is measured once instead.
	empty := manifest
	empty.Files = nil
	base, ok := marshalManifest(empty)
	if !ok {
		return nil
	}
	remaining := manifestPromptBudget - len(base) - len(manifestTruncationAllowance)
	if remaining <= 0 {
		return nil
	}
	kept := make([]domain.ContextFile, 0, len(ordered))
	for _, file := range ordered {
		entry, err := json.MarshalIndent(file, "    ", "  ")
		if err != nil {
			continue
		}
		cost := len(entry) + 8
		if cost > remaining {
			break
		}
		remaining -= cost
		kept = append(kept, file)
	}
	// Restore the manifest's own ordering for the entries that survived, so the
	// prompt reads like a normal manifest rather than a re-sorted one.
	keptPaths := make(map[string]bool, len(kept))
	for _, file := range kept {
		keptPaths[file.Path] = true
	}
	inOriginalOrder := make([]domain.ContextFile, 0, len(kept))
	for _, file := range manifest.Files {
		if keptPaths[file.Path] {
			inOriginalOrder = append(inOriginalOrder, file)
		}
	}
	return inOriginalOrder
}

// manifestTruncationAllowance reserves room for the note that declares the
// truncation, so adding that note can never push the prompt back over budget.
const manifestTruncationAllowance = `

NOTE — this inventory is TRUNCATED. It lists 000000 of 000000 files; 000000 entries were omitted to keep this prompt within the size the transport accepts. The attached context bundle carries the complete set, and 0000000000000000000000000000000000000000000000000000000000000000 is the authoritative manifest identity. Absence from the list above is NOT evidence that a file does not exist: when a path you need is missing here, say so in turn.message instead of recreating the file.`

func pathDepth(path string) int {
	return strings.Count(strings.Trim(strings.ReplaceAll(path, "\\", "/"), "/"), "/")
}
