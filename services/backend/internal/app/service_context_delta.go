package app

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/projectknowledge"
	"kernl.local/harness/backend/internal/sandbox"
)

const (
	// maxContextDeltaFiles bounds the listed divergence. A continuation whose
	// project moved in more places than this is not a drift the planner should
	// reconcile path by path — it is told the list is a sample and that the
	// attached manifest remains authoritative.
	maxContextDeltaFiles = 200
	// maxContextDeltaPatchBytes bounds the real diff carried with a
	// continuation. Beyond this the round trip costs more than re-reading the
	// files the report already named.
	maxContextDeltaPatchBytes = 384 << 10
	// maxInlineContextDeltaPatchBytes is how much of that diff is written
	// directly into the prompt. Every transport delivers the prompt, but only
	// some deliver side files, so a small diff is inlined to make the report
	// useful everywhere; a large one stays a file reference.
	maxInlineContextDeltaPatchBytes = 64 << 10
	// contextDeltaProbeTimeout keeps divergence measurement off the critical
	// path of a user's request, exactly like environment measurement.
	contextDeltaProbeTimeout = 20 * time.Second
	// maxRetainedContextDeltas matches the request context/base retention, so
	// a delta never outlives the request whose transport still needs it.
	maxRetainedContextDeltas = 24
)

// computeContextDelta measures how the local project diverged between the
// snapshot a Main Request was planned against and the snapshot this
// continuation was built from.
//
// Divergence is always measured against the ROOT request, never against the
// immediately preceding round. The planner holds one complete baseline — the
// one the Main Request delivered — and every later round is a correction on top
// of it. A root-anchored report is therefore self-healing: if one round's
// report was lost, truncated, or never read, the next round's still describes
// the full divergence rather than a fragment that only makes sense chained to
// a report the planner may not have.
//
// Every failure degrades. A project with no Git, a request with no anchored
// base, or a Git that refuses for any reason falls back to the manifest-hash
// comparison Wharnex already keeps, and failing that reports the divergence as
// unknown. Neither may fail the user's request.
func (s *Service) computeContextDelta(ctx context.Context, item domain.Session, baseRequestID, currentRequestID, currentCommit string) domain.ContextDelta {
	delta := domain.ContextDelta{
		Protocol:           domain.ContextDeltaProtocolV1,
		BaseRequestID:      strings.TrimSpace(baseRequestID),
		CurrentRequestID:   strings.TrimSpace(currentRequestID),
		BaseManifestSHA256: requestBaseline(item, baseRequestID),
		CurrentManifestSHA: strings.TrimSpace(item.Context.Manifest.SHA256),
		CurrentCommit:      strings.TrimSpace(currentCommit),
		BaseCommit:         requestBaseCommit(item, baseRequestID),
		Source:             domain.ContextDeltaSourceUnavailable,
	}
	if delta.BaseRequestID == "" || delta.BaseRequestID == delta.CurrentRequestID {
		return domain.ContextDelta{}
	}
	// An identical context fingerprint is a positive, useful answer: it tells
	// the planner the baseline it holds is still exact, which is the whole
	// reason a continuation may skip re-reading the project.
	if delta.BaseManifestSHA256 != "" && delta.BaseManifestSHA256 == delta.CurrentManifestSHA {
		delta.Source = domain.ContextDeltaSourceManifest
		delta.Unchanged = true
		return delta
	}
	if delta.BaseCommit != "" && delta.CurrentCommit != "" {
		probeCtx, cancel := context.WithTimeout(ctx, contextDeltaProbeTimeout)
		defer cancel()
		if files, err := sandbox.DiffBetween(probeCtx, item.ProjectPath, delta.BaseCommit, delta.CurrentCommit); err == nil {
			delta.Source = domain.ContextDeltaSourceGit
			delta.Files, delta.Truncated = boundedDeltaFiles(files)
			delta.Unchanged = len(delta.Files) == 0 && !delta.Truncated
			if !delta.Unchanged {
				s.attachDeltaPatch(probeCtx, item.ProjectPath, &delta)
			}
			return delta
		} else if s.bus != nil {
			s.bus.Publish(item.ID, "context.delta_degraded", map[string]any{
				"request_id": delta.CurrentRequestID, "base_request_id": delta.BaseRequestID, "error": err.Error(),
			})
		}
	}
	// Manifest fallback: path-level only, but still far better than handing the
	// planner two opaque fingerprints and letting it guess what moved.
	if changed, complete := requestSnapshotDelta(item, delta.BaseRequestID, delta.BaseManifestSHA256, delta.CurrentManifestSHA); complete {
		delta.Source = domain.ContextDeltaSourceManifest
		files := make([]sandbox.DeltaFile, 0, len(changed))
		for _, path := range changed {
			files = append(files, sandbox.DeltaFile{Path: path, Status: "changed"})
		}
		delta.Files, delta.Truncated = boundedDeltaFiles(files)
		delta.Unchanged = len(delta.Files) == 0 && !delta.Truncated
		delta.PatchOmittedReason = "git comparison unavailable; only changed paths could be determined"
		return delta
	}
	delta.PatchOmittedReason = "wharnex could not determine what changed since the base request"
	return delta
}

// attachDeltaPatch adds the real unified diff when it fits the budget. An
// absent patch is always explained, because "these files changed" with no
// reason given for the missing content invites the planner to assume the
// changes were cosmetic.
func (s *Service) attachDeltaPatch(ctx context.Context, projectPath string, delta *domain.ContextDelta) {
	patch, ok, err := sandbox.DiffPatchBetween(ctx, projectPath, delta.BaseCommit, delta.CurrentCommit, maxContextDeltaPatchBytes, []string{projectknowledge.DirectoryName})
	switch {
	case err != nil:
		delta.PatchOmittedReason = "diff could not be produced: " + truncateRepairText(err.Error(), 400)
	case !ok:
		delta.PatchOmittedReason = fmt.Sprintf("diff exceeds the %d KiB transport budget; read the listed files instead", maxContextDeltaPatchBytes>>10)
	default:
		delta.Patch = patch
	}
}

func boundedDeltaFiles(files []sandbox.DeltaFile) ([]domain.ContextDeltaFile, bool) {
	sort.Slice(files, func(i, j int) bool { return files[i].Path < files[j].Path })
	truncated := len(files) > maxContextDeltaFiles
	if truncated {
		files = files[:maxContextDeltaFiles]
	}
	out := make([]domain.ContextDeltaFile, 0, len(files))
	for _, file := range files {
		path := strings.TrimSpace(file.Path)
		if path == "" {
			continue
		}
		out = append(out, domain.ContextDeltaFile{Path: path, Status: file.Status, Additions: file.Additions, Deletions: file.Deletions})
	}
	return out, truncated
}

// recordRequestContextDelta stores the report one request was sent, so every
// transport materializes exactly what the prompt described instead of
// recomputing a drifting answer at download time.
func recordRequestContextDelta(item *domain.Session, requestID string, delta domain.ContextDelta) {
	requestID = strings.TrimSpace(requestID)
	if requestID == "" || delta.Protocol == "" {
		return
	}
	if item.RequestContextDeltas == nil {
		item.RequestContextDeltas = make(map[string]domain.ContextDelta, 1)
	}
	item.RequestContextDeltas[requestID] = delta
	if len(item.RequestContextDeltas) <= maxRetainedContextDeltas {
		return
	}
	keep := map[string]bool{requestID: true, item.LastRequestID: true}
	for _, id := range item.PendingManualRequestIDs {
		keep[id] = true
	}
	for id := range item.RequestContextDeltas {
		if keep[id] {
			continue
		}
		delete(item.RequestContextDeltas, id)
		if len(item.RequestContextDeltas) <= maxRetainedContextDeltas {
			break
		}
	}
}

func requestContextDelta(item domain.Session, requestID string) (domain.ContextDelta, bool) {
	delta, ok := item.RequestContextDeltas[strings.TrimSpace(requestID)]
	return delta, ok && delta.Protocol != ""
}

// renderContextDelta produces the prompt section. It states the conclusion
// first — whether the held baseline is still usable — because that is the
// decision the planner has to make before reading anything else.
func renderContextDelta(delta domain.ContextDelta) string {
	if delta.Protocol == "" {
		return ""
	}
	var out strings.Builder
	out.WriteString("\nLOCAL PROJECT DIVERGENCE — " + domain.ContextDeltaProtocolV1 + ":\n")
	out.WriteString("- You already hold the complete project snapshot delivered with request " + delta.BaseRequestID + ". This section states exactly how the local project has moved since then, so you do NOT need a fresh baseline and MUST NOT ask for one.\n")
	switch {
	case delta.Unchanged:
		out.WriteString("- VERDICT: UNCHANGED. Not one project file diverged from that snapshot. Every path, line number and content you reasoned about is still exact; a patch that failed earlier did not fail because the tree moved.\n")
	case delta.Source == domain.ContextDeltaSourceUnavailable:
		out.WriteString("- VERDICT: UNKNOWN. Wharnex could not measure the divergence (" + delta.PatchOmittedReason + "). Treat the attached PROJECT MANIFEST as authoritative and re-verify any path you are about to patch.\n")
	default:
		out.WriteString(fmt.Sprintf("- VERDICT: %d file(s) diverged. Everything NOT listed below is byte-identical to the snapshot you hold.\n", len(delta.Files)))
	}
	if delta.BaseManifestSHA256 != "" {
		out.WriteString("- Base snapshot sha256: " + delta.BaseManifestSHA256 + "\n")
	}
	if delta.CurrentManifestSHA != "" {
		out.WriteString("- Current snapshot sha256: " + delta.CurrentManifestSHA + " (this request's authoritative base_context_sha256)\n")
	}
	if len(delta.Files) > 0 {
		out.WriteString("- Diverged paths:\n")
		for _, file := range delta.Files {
			line := "  - " + file.Path + " (" + file.Status
			if file.Additions > 0 || file.Deletions > 0 {
				line += fmt.Sprintf(", +%d/-%d", file.Additions, file.Deletions)
			}
			out.WriteString(line + ")\n")
		}
	}
	if delta.Truncated {
		out.WriteString("- The list above is TRUNCATED. More paths diverged than Wharnex will enumerate; use the attached manifest as authoritative.\n")
	}
	switch {
	case delta.Patch == "" && delta.PatchOmittedReason != "" && !delta.Unchanged:
		out.WriteString("- No diff is available: " + delta.PatchOmittedReason + ".\n")
	case delta.Patch == "":
	case len(delta.Patch) <= maxInlineContextDeltaPatchBytes:
		// Inlining a small diff is what makes this report useful on every
		// transport rather than only the ones that can carry side files. A
		// continuation prompt is read in full; a reference to an attachment the
		// runtime never fetched is worth nothing.
		out.WriteString("- The exact unified diff of those changes follows. Rebase your pending edit onto it instead of re-reading the whole project. It is REFERENCE ONLY: never echo it back as your own patch.\n")
		out.WriteString("```diff\n" + delta.Patch + "\n```\n")
	default:
		out.WriteString("- The exact unified diff of those changes is attached as context-delta/delta.patch. Read it and rebase your pending edit onto it instead of re-reading the whole project.\n")
	}
	out.WriteString("- Any patch you return MUST apply to the CURRENT content described here, and MUST set base_context_sha256 to this request's manifest sha256.\n")
	return out.String()
}
