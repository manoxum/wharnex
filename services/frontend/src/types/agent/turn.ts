import type { KnowledgeCategory } from '../knowledge/evolution'

export type TurnKind = 'answer' | 'clarification' | 'investigation' | 'plan' | 'workflow' | 'context_request' | 'change' | 'blocked'
export type ContextMode = 'full' | 'partial'

export type InterviewOption = { id: string; label: string }
export type InterviewQuestion = { id: string; prompt: string; allow_multiple?: boolean; options: InterviewOption[] }
export type Interview = { protocol: 'harness.interview/v1'; questions: InterviewQuestion[] }

export type AgentTurn = {
  protocol: 'harness.turn/v1'
  request_id: string
  kind: TurnKind
  chat_title?: string
  message: string
  outcome?: { status: 'completed' | 'failed' | 'partial'; reason_code?: string; message?: string; retryable: boolean }
	interview?: Interview
	context_paths?: string[]
}

export type ProjectKnowledgeEntry = {
  id: string
  content: string
  category?: KnowledgeCategory
  version: number
  updated_at: string
  updated_by_request_id?: string
}

export type ProjectKnowledgeCatalog = {
  project_path: string
  revision: number
  entries: ProjectKnowledgeEntry[]
  updated_at: string
  updated_by_request_id?: string
}

export type ProjectKnowledge = {
  project_path: string
  content: string
  version: number
  updated_at: string
  updated_by_request_id?: string
}
