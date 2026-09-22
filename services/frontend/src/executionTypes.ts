export type ExecutionMode = 'protected' | 'unprotected' | 'full'

export type ExecutionApproval = {
  kind: string
  argv?: string[]
  rationale?: string
  effect: string
  host_impact: string
  requires_sudo_password?: boolean
  bypass_in_full?: boolean
}
