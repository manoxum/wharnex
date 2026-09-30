export type GitBranchActionResult = { outcome: string; remote?: string; branch?: string; ref?: string; commit_sha?: string; paths?: string[]; conflict_id?: string; detail?: string }
export type GitBranchMutationResult = { outcome: 'created' | 'deleted'; branch: string }
export type GitReleaseNotesResult = { body: string; commit_count: number }
export type GitReleaseResult = { outcome: 'published'; remote: string; branch: string; tag: string; commit_sha: string; release_url: string }

// One conversation a chat with a lost binding may belong to, with the evidence
// that ties it to that chat so the operator can judge it instead of guessing.
export type WorkspaceChatBindingCandidate = {
  chatgpt_url: string
  conversation_id: string
  evidence: 'agent_queue' | 'transcript' | 'session_events'
  bound_to_chat_id?: string
  conflict: boolean
}
export type WorkspaceChatBindingRecovery = {
  chat_id: string
  bound: boolean
  chatgpt_url?: string
  candidates: WorkspaceChatBindingCandidate[]
}
