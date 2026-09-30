export type ProjectTodoKind = 'feature' | 'improvement' | 'error'
export type ProjectTodoUrgency = 'very_urgent' | 'urgent' | 'normal' | 'no_urgency'
export type ProjectTodoAttachment = { name: string; size: number; mime: string; storage_ref: string; preview_kind?: 'thumbnail' | 'icon' | 'none' }
export type ProjectTodo = {
  id: string
  project_path: string
  body: string
  status: 'open' | 'done'
  kind?: ProjectTodoKind
  urgency?: ProjectTodoUrgency
  description?: string
  pre_plan?: string[]
  classification_status: 'queued' | 'classified' | 'failed'
  classification_task_id?: string
  classification_error?: string
  attachment_cache_key?: string
  attachments?: ProjectTodoAttachment[]
  project_files?: string[]
  execution_status?: 'open' | 'processing' | 'done' | 'failed'
  execution_request_id?: string
  execution_session_id?: string
  execution_chat_id?: string
  execution_target?: 'chat' | 'orchestrator' | string
  execution_plan_id?: string
  execution_error?: string
  archived_at?: string
  created_at: string
  updated_at: string
}
