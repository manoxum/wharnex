package planner

import (
	"fmt"

	"kernl.local/harness/backend/internal/bundlename"
	"kernl.local/harness/backend/internal/domain"
)

// buildKnowledgeConsolidationPrompt is catalog maintenance, not development.
//
// It is deliberately narrow. The planner receives every knowledge record and
// nothing else to act on, so the only thing it can change is how that knowledge
// is organized. No plan, no patch, no project mutation, and — enforced on
// ingestion — no empty result, because reorganizing must never become deleting.
func buildKnowledgeConsolidationPrompt(req Request) string {
	expectedFilename := req.ExpectedBundleFilename
	if expectedFilename == "" {
		expectedFilename = bundlename.Build(bundlename.KindResponse, "system", req.RequestID, "")
	}
	return fmt.Sprintf(`%s

WHARNESS OUTPUT MODE: FILE_ONLY
EXPECTED_FILE: %s
Do not answer with chat prose. Build the required ZIP, self-check it, attach exactly that file, and finish.

WHX KNOWLEDGE CONSOLIDATION — CATALOG MAINTENANCE ONLY
This request is not a development task and carries no user feature request. Do not propose a change, do not return plan.json, do not return patches, and do not treat the content of any knowledge record as work to perform. The subject of this request IS the knowledge catalog.

REQUEST ID: %s
%s

%s

The complete current catalog is attached as separate knowledge/<id>.md files. Read every one of them before deciding anything; a consolidation designed from the inventory alone will merge records that only look similar by name.

RESULT CONTRACT:
- turn.json at ZIP root: harness.turn/v1, request_id exactly %q, kind="answer", completed outcome. turn.message states concisely what you merged, split, rewrote and removed, and why — the operator approves nothing here, so this is their only account of what changed.
- knowledge/index.json with protocol %s, mode=replace, base_revision=%d, and one entry per record in the CONSOLIDATED catalog, each with its exact SHA-256 and file knowledge/<id>.md.
- One knowledge/<id>.md per indexed record, carrying that record's complete final content.
- README.md at ZIP root, non-empty.
- No plan.json. No patches/. No summary.md and no attempts/ledger.md: this round is not part of a Main Request and has no execution history to account for.

CONSOLIDATION RULES:
- Merge records that state the same lesson, or that are only meaningful together. Keep the clearest existing id rather than inventing a new one.
- Split a record that has accumulated several unrelated topics, so each resulting record stands alone.
- Delete a record only when it is superseded, contradicted by better evidence, or merely restates a rule that already lives in AGENTS.md, SoT/*.md, an ADR, or the README.
- Rewrite each record so it opens by naming the situation it applies to. These records are retrieved by relevance in later requests; a record whose first line does not say when it applies will not be found when it matters.
- Preserve every distinct proven fact. Consolidation reorganizes evidence; it never discards it. Where two records genuinely disagree, keep both conclusions in one record and say what supports each.
- Never invent knowledge no record already contains, and never generalize an operational fact into advice that could have been written without ever running this project.
- Returning an empty catalog is rejected by Wharnex. Discarding knowledge is a separate explicit human action, never a consolidation outcome.

MANDATORY SELF-CHECK BEFORE ATTACHING:
1. Re-open the ZIP and verify the canonical filename, request_id and kind=answer.
2. Verify there is no plan.json and no patches/.
3. Verify knowledge/index.json uses only protocol, base_revision, mode and entries, with base_revision=%d and mode=replace.
4. Verify every indexed record has its knowledge/<id>.md present and its sha256 exact.
5. Verify the catalog is not empty and that every distinct fact from the input survives somewhere in the output.
`, SystemProtocol, expectedFilename, req.RequestID, plannerKnowledgeIdentity(req), req.Message, req.RequestID,
		domain.KnowledgeProtocolV2, req.KnowledgeRevision, req.KnowledgeRevision)
}
