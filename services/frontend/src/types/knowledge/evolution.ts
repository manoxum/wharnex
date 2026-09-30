import type { HarnessEvent } from '../agent/task-queue'

export type KnowledgeCategory = 'conflict_resolution' | 'patch_strategy' | 'execution_repair' | 'verification' | 'runtime_environment' | 'protocol_transport' | 'product_domain' | 'general'

export type EvolutionKnowledgeEvidence = {
  project_path: string
  project_name: string
  id: string
  category: KnowledgeCategory
  excerpt: string
  version: number
  updated_at: string
  updated_by_request_id?: string
}

export type EvolutionKnowledgeRef = { project_path: string; id: string }

export type EvolutionEvidence = {
  events: HarnessEvent[]
  counts: Record<string, number>
  projects: string[]
  categories: string[]
  total: number
  truncated: boolean
  knowledge: EvolutionKnowledgeEvidence[]
  knowledge_counts: Record<string, number>
  knowledge_categories: string[]
  knowledge_total: number
  knowledge_truncated: boolean
}
