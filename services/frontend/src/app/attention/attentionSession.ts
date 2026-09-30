import type { AttentionRecord, Session } from '../../types'

// Background chat maintenance runs rarely on purpose: it drives real ChatGPT
// account operations, and those are serialized against the user's own work.
// Adapts a compact attention record into the Session shape the attention center
// already consumes. Only nine fields are ever read, and the two collections are
// read for their length alone — so representing "n pending changes" as n empty
// slots is faithful to what the consumer asks, without carrying the megabyte of
// payload that made polling fatal.
export function attentionSessionFrom(record: AttentionRecord, projectPath: string): Session {
  return {
    id: record.session_id,
    project_path: projectPath,
    chat_id: record.chat_id,
    execution_mode: record.execution_mode || 'protected',
    automation_mode: 'auto',
    state: record.state,
    created_at: '',
    context: { id: '', manifest: { id: '', project_root: projectPath, sha256: '', files: [], excluded: [], text_truncated: false } },
    failure_kind: record.failure_kind,
    last_request_id: record.last_request_id,
    last_repair_error: record.last_repair_error,
    last_turn: record.last_turn,
    policy: record.policy,
    plan: record.has_plan ? ({
      plan_id: record.plan_id,
      request_id: record.plan_request_id,
      document: record.has_plan_document ? 'Execution contract available' : undefined,
      debug: record.debug_target ? { protocol: 'harness.debug/v1', target: record.debug_target, access: record.debug_access, rationale: record.debug_rationale || 'Diagnostic evidence requested' } : undefined,
    } as Session['plan']) : undefined,
    last_execution: record.last_execution_plan_id ? ({ plan_id: record.last_execution_plan_id } as Session['last_execution']) : undefined,
    pending_host_changes: Array.from({ length: record.pending_host_changes }) as Session['pending_host_changes'],
    pending_manual_request_ids: Array.from({ length: record.pending_manual_requests || 0 }, (_, index) => `compact-${index}`),
    planner_in_flight: record.planner_in_flight,
    last_manual_prompt: record.has_manual_prompt ? 'Disponível' : undefined,
    self_evolution: record.self_evolution,
    self_evolution_activation: record.self_evolution_activation,
    self_evolution_impacts: record.self_evolution_impacts,
    last_host_applied_at: record.last_host_applied_at,
    pending_knowledge_review_request_id: record.pending_knowledge_review_request_id,
    integration_conflict: record.integration_conflict
      ? ({ id: record.integration_conflict.id, paths: Array.from({ length: record.integration_conflict.path_count }) } as Session['integration_conflict'])
      : undefined,
    interrupted_execution: record.interrupted_execution as Session['interrupted_execution'],
  }
}
