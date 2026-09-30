package planner

import (
	"encoding/json"
	"fmt"

	"kernl.local/harness/backend/internal/orchestrator"
)

const OrchestratorSystemPrompt = `You are the planning component for Wharnex Orchestrator. Convert one project objective into a bounded dependency DAG of durable tasks. You plan only: never emit shell commands, patches, execution plans, credentials, or instructions that bypass Wharnex Policy or Protected execution. Keep tasks cohesive, testable and independently reviewable. Dependencies must be explicit and acyclic. Scope hints are advisory only.`

func buildOrchestratorManualPrompt(req Request) string {
	manifest := req.ContextManifest
	manifest.ExcludedDetails = nil
	encoded, _ := json.MarshalIndent(manifest, "", "  ")
	return fmt.Sprintf(`%s

%s

When enough context is available, return one UTF-8 JSON object using protocol %s with this exact top-level shape:
{
  "protocol": "%s",
  "title": "short plan title",
  "objective": "normalized objective",
  "assumptions": ["assumption"],
  "tasks": [
    {
      "id": "t1",
      "title": "task title",
      "description": "what this unit changes",
      "acceptance_criteria": ["observable criterion"],
      "depends_on": [],
      "priority": "low|normal|high|urgent",
      "capability": "short worker capability",
      "complexity": "low|medium|high",
      "parallelizable": false,
      "impact_files": ["advisory/path"],
      "read_files": ["advisory/path"],
      "barrier_files": ["advisory/path"]
    }
  ]
}

Rules: 1..128 tasks; unique ids; no self-dependencies; every dependency names another task in the same response; no cycles; never include commands or patch text.

Tasks without a dependency path between them run concurrently on separate Workers, each in its own isolated copy, and integrate into the project independently. Therefore: a task that validates, stabilizes, fixes a baseline for, reviews, or builds on the result of other tasks MUST list every one of them in depends_on — never rely on it waiting or failing while they still run. Two tasks that edit the same file or contract MUST be ordered by depends_on; parallelizable tasks declare disjoint impact_files.

REQUEST ID: %s
OBJECTIVE:
%s

PROJECT MANIFEST:
%s`, OrchestratorSystemPrompt, orchestratorContextModePrompt(req), orchestrator.ProtocolV1, orchestrator.ProtocolV1, req.RequestID, req.Message, encoded)
}

func orchestratorContextModePrompt(req Request) string {
	if req.ContextMode != "partial" {
		return "CONTEXT DELIVERY: Full. The project snapshot is attached when context is enabled for this planning request."
	}
	return `CONTEXT DELIVERY: Partial. The request carries context-map/<source>/maps plus context-map/<source>/semantic-index first. Inspect the exact inventories and use the semantic candidates/groups and remaining byte/round budget only as advisory guidance. If you need specific file bodies, return a ZIP response containing context-request.json instead of plan.json. The JSON must have exactly protocol="harness.orchestrator-context-request/v1", request_id equal to this request, and context_paths with one or more exact context/, ref-context/, or att-context/ archive paths that form the coherent evidence set you need; do not split a necessary set merely to satisfy a path count. Wharnex validates and reads those files from the captured snapshot, then sends a new request ZIP in this conversation containing the cumulative selected files. At most six increments are allowed. Once enough evidence is present, return the ordinary plan.json bundle. Do not emit commands, patches, or prose as the result.`
}
