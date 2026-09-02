export type CommandSpec = {
  argv: string[]
  cwd: string
  timeout_seconds: number
  network: boolean
  expected_exit_codes: number[]
}

export type Operation = {
  type: 'apply_patch' | 'command'
  patch: string
  command: CommandSpec
}

export type ExecutionPlan = {
  protocol: 'harness.execution/v1'
  plan_id: string
  request_id: string
  status: 'ready' | 'blocked'
  summary: string
  risk: 'low' | 'medium' | 'high'
  requires_approval: boolean
  operations: Operation[]
  verification: CommandSpec[]
}

export type PolicyDecision = {
  allowed: boolean
  requires_approval: boolean
  risk: 'low' | 'medium' | 'high'
  reasons: string[]
}

export type CommandResult = {
  argv: string[]
  cwd: string
  exit_code: number
  stdout: string
  stderr: string
  duration_ms: number
  success: boolean
}

export type ExecutionResult = {
  plan_id: string
  success: boolean
  started_at: string
  completed_at: string
  commands: CommandResult[]
  error?: string
}

export type ContextManifest = {
  id: string
  project_root: string
  sha256: string
  files: Array<{ path: string; size: number; sha256: string }>
  excluded: string[]
  text_truncated: boolean
}

export type Session = {
  id: string
  project_path: string
  state: string
  created_at: string
  context: { id: string; manifest: ContextManifest }
  plan?: ExecutionPlan
  policy?: PolicyDecision
  last_execution?: ExecutionResult
  last_manual_prompt?: string
  last_request_id?: string
}

export type HarnessEvent = {
  id: string
  session_id: string
  type: string
  timestamp: string
  data: Record<string, unknown>
}

export type AppConfig = {
  planner: 'manual' | 'openai' | string
  sandbox: 'docker' | 'local' | string
  model: string
  api_configured: boolean
  chatgpt_web_embed: boolean
}

export type FileEntry = {
  path: string
  name: string
  kind: 'file' | 'directory'
  size: number
}

export type WorkspaceFile = {
  path: string
  content: string
  sha256: string
  size: number
}

export type WorkspaceMode = 'editor' | 'agent'

export type ChatItem = { id: string; role: 'user' | 'harness'; text: string; meta?: string }
