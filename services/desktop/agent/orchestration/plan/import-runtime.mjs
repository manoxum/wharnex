export function createOrchestratorPlanImport({ sanitizeSessionId, BACKEND_URL, fetch }) {
  async function importOrchestratorWorkerPlanBundle(sessionID, requestID, bytes) {
    const sessionId = sanitizeSessionId(sessionID)
    const requestId = String(requestID || '').trim()
    if (!/^orp_[A-Za-z0-9_-]{8,180}$/.test(requestId)) throw new Error('invalid orchestrator request id')
    const target = new URL(`/api/sessions/${encodeURIComponent(sessionId)}/orchestrator/plans/import-bundle`, BACKEND_URL)
    target.searchParams.set('request_id', requestId)
    const response = await fetch(target, {
      method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/zip' }, body: bytes,
    })
    if (!response.ok) {
      let detail = ''
      try { detail = String((await response.json())?.error?.message || '') } catch {}
      throw new Error(`orchestrator plan bundle import HTTP ${response.status}${detail ? `: ${detail}` : ''}`)
    }
    return response.json()
  }

  async function importOrchestratorWorkerPlan(sessionID, requestID, proposal) {
    const sessionId = sanitizeSessionId(sessionID)
    const requestId = String(requestID || '').trim()
    if (!/^orp_[A-Za-z0-9_-]{8,180}$/.test(requestId)) throw new Error('invalid orchestrator request id')
    const target = new URL(`/api/sessions/${encodeURIComponent(sessionId)}/orchestrator/plans/import`, BACKEND_URL)
    const response = await fetch(target, {
      method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request_id: requestId, proposal }),
    })
    if (!response.ok) {
      let detail = ''
      try { detail = String((await response.json())?.error?.message || '') } catch {}
      throw new Error(`orchestrator plan import HTTP ${response.status}${detail ? `: ${detail}` : ''}`)
    }
    return response.json()
  }

  async function checkpointChatAgentTask(taskID, owner, payload) {
    const id = String(taskID || '').trim()
    const leaseOwner = String(owner || '').trim()
    if (!/^cat_[a-f0-9]{20}$/.test(id) || !leaseOwner) throw new Error('invalid chat-agent checkpoint identity')
    const target = new URL(`/api/chat-agent/tasks/${encodeURIComponent(id)}/checkpoint`, BACKEND_URL)
    const response = await fetch(target, {
      method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner: leaseOwner, payload }),
    })
    if (!response.ok) {
      let detail = ''
      try { detail = String((await response.json())?.error?.message || '') } catch {}
      throw new Error(`chat-agent checkpoint HTTP ${response.status}${detail ? `: ${detail}` : ''}`)
    }
    return response.json()
  }

  // The delivery instruction, written once so the first submission and a
  // re-request cannot drift into asking for different things.
  function orchestratorPlanInstruction(prompt, filename, rerequest) {
    const delivery = filename.endsWith('.zip')
      ? `WHARNEX ORCHESTRATOR DELIVERY — BUNDLE ONLY\nCreate and attach one ZIP archive named exactly ${filename}. It must contain a single UTF-8 entry named exactly plan.json at the archive root, whose content is the single harness.orchestrator-plan/v1 object requested above. Do not put the JSON or other answer prose in the conversation. Self-check the archive name, the plan.json entry, JSON syntax, unique task ids, dependency references and acyclicity before attaching it.`
      : `WHARNEX ORCHESTRATOR DELIVERY — FILE ONLY\nCreate and attach one UTF-8 JSON file named exactly ${filename}. The file content must be the single harness.orchestrator-plan/v1 object requested above. Do not put the JSON or other answer prose in the conversation. Self-check the filename, JSON syntax, unique task ids, dependency references and acyclicity before attaching it.`
    if (!rerequest) return `${prompt}\n\n${delivery}`
    // The plan was produced; only its file is no longer downloadable. Ask for the
    // artifact again without restarting the planning work.
    return `WHARNEX ORCHESTRATOR RE-DELIVERY — SAME PLAN\n\nThe file you attached earlier is no longer downloadable. Do not re-plan and do not change the plan: attach the same harness.orchestrator-plan/v1 result again as a fresh file.\n\n${delivery}`
  }

  // Validate and import one orchestrator plan artifact. Shared by the live
  // download and by an artifact retained between attempts, so both reach the
  // backend through exactly the same protocol checks.
  function parseOrchestratorPlanProposal(value) {
    let proposal
    try { proposal = JSON.parse(value) } catch { throw new Error('orchestrator worker returned invalid JSON') }
    if (!proposal || proposal.protocol !== 'harness.orchestrator-plan/v1' || !Array.isArray(proposal.tasks)) {
      throw new Error('orchestrator worker returned mismatched protocol metadata')
    }
    return proposal
  }

  function orchestratorPlanResult(requestId, imported) {
    if (imported?.delivery_status === 'context_increment' && Array.isArray(imported.context_paths)) {
      return { status: 'context_increment', contextPaths: imported.context_paths }
    }
    return {
      status: 'done',
      payload: {
        protocol: 'harness.orchestrator-planning-result/v1', request_id: requestId,
        plan_id: String(imported?.plan?.id || ''), task_count: Number(imported?.tasks?.length || 0),
      },
    }
  }

  // One import path for both deliveries, so the bundle and the legacy artifact
  // reach the backend through the same identity checks. The bundle is uploaded
  // verbatim: the Desktop is transport and never opens the archive.
  async function importOrchestratorPlanArtifact(sessionId, requestId, delivery, bytes) {
    if (delivery === 'bundle') return importOrchestratorWorkerPlanBundle(sessionId, requestId, bytes)
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return importOrchestratorWorkerPlan(sessionId, requestId, parseOrchestratorPlanProposal(text))
  }

  // A retained artifact is best-effort: if it is unusable the attempt continues
  // to the live path rather than failing a request that can still be answered.
  async function importRetainedOrchestratorPlan(sessionId, requestId, delivery, value) {
    try {
      const imported = await importOrchestratorPlanArtifact(sessionId, requestId, delivery, value)
      return orchestratorPlanResult(requestId, imported)
    } catch (error) {
      console.warn(`[orchestrator-worker] retained plan for request=${requestId} could not be imported: ${error instanceof Error ? error.message : String(error)}`)
      return undefined
    }
  }

  return {
    importOrchestratorWorkerPlanBundle, importOrchestratorWorkerPlan,
    checkpointChatAgentTask, orchestratorPlanInstruction,
    parseOrchestratorPlanProposal, orchestratorPlanResult,
    importOrchestratorPlanArtifact, importRetainedOrchestratorPlan,
  }
}
