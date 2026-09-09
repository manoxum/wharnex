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

Return ONLY one UTF-8 JSON object using protocol %s with this exact top-level shape:
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

REQUEST ID: %s
OBJECTIVE:
%s

PROJECT MANIFEST:
%s`, OrchestratorSystemPrompt, orchestrator.ProtocolV1, orchestrator.ProtocolV1, req.RequestID, req.Message, encoded)
}
