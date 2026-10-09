package planner

import (
	"fmt"
	"strings"

	"kernl.local/harness/backend/internal/domain"
)

func contextModePrompt(req Request) string {
	if domain.EffectiveContextMode(req.ContextMode) != domain.ContextModePartial {
		return "CONTEXT DELIVERY: Full. The request archive carries the complete eligible project and reference snapshots.\n\n"
	}
	var out strings.Builder
	out.WriteString(`CONTEXT DELIVERY: Partial (harness.context-request/v1).
The Main Request archive initially carries the user request, context-map/<source>/maps inventories, context-map/<source>/semantic-index guidance, redacted sensitive maps, and the source index. Project and reference file bodies are added only when requested. The full snapshot SHA-256 remains the authoritative concurrency base, even though its bodies are not all transported.
The project's normative documents (root AGENTS.md, SoT/**/*.md, root SECURITY.md and every scoped AGENTS.md) are preselected from the first archive of every Main Request and listed below as already selected. Read them before planning and follow them; never request them again. A normative file absent from that list either does not exist or exceeded the normative seed budget and may be requested.
Read context-map/<source>/maps together with context-map/<source>/semantic-index first. The semantic candidates, relations and groups are advisory: use them to choose one coherent set of one or more exact archive paths that fits the remaining byte budget, and do not split a necessary set merely to satisfy a path count. If specific eligible files are needed to answer or implement, return a completed turn.json with kind="context_request", a short message explaining the need, and context_paths containing those exact paths from context/, ref-context/, or att-context/. Include README.md, summary.md, attempts/ledger.md and knowledge/index.json as in other response bundles. Do not include plan.json, patches, or shell commands. Wharnex will validate each path against its captured snapshot, read the file itself, and send a derived request archive containing all selected files accumulated so far. Repeat only when more evidence is needed. Wharnex imposes no increment-round limit: you decide when the evidence suffices and stop requesting; only the cumulative selected-bytes budget is bounded. Do not request a file already supplied. If the maps and selected files suffice, return the normal terminal answer, investigation, plan, change, clarification, or blocked bundle. A context_request does not grant write authority to a reference or attachment.
`)
	if len(req.ContextPaths) == 0 {
		out.WriteString("Currently selected file bodies: none.\n\n")
	} else {
		out.WriteString(fmt.Sprintf("Currently selected file bodies (%d):\n", len(req.ContextPaths)))
		for _, path := range req.ContextPaths {
			out.WriteString("- " + path + "\n")
		}
		out.WriteByte('\n')
	}
	return out.String()
}
