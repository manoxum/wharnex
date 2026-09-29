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
The Main Request archive initially carries the user request, context-map/main/maps and context-map/@ref/<project>/maps inventories, redacted sensitive maps, and the source index. Project and reference file bodies are added only when requested. The full snapshot SHA-256 remains the authoritative concurrency base, even though its bodies are not all transported.
Read the maps first. If a specific eligible file is needed to answer or implement, return a completed turn.json with kind="context_request", a short message explaining the need, and context_paths containing 1..32 exact archive paths from context/, ref-context/, or att-context/. Include README.md, summary.md, attempts/ledger.md and knowledge/index.json as in other response bundles. Do not include plan.json, patches, or shell commands. Wharnex will validate each path against its captured snapshot, read the file itself, and send a derived request archive containing all selected files accumulated so far. Repeat only when more evidence is needed; at most six increment rounds are available. Do not request a file already supplied. If the maps and selected files suffice, return the normal terminal answer, investigation, plan, change, clarification, or blocked bundle. A context_request does not grant write authority to a reference or attachment.
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
