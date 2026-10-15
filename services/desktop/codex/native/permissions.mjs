export function nativePermissionPolicy(level = 'full') {
  if (!['ask', 'auto', 'full'].includes(level)) throw new Error('Nível de permissão Codex inválido.')
  return level === 'full'
    ? { level, thread: { approvalPolicy: 'never', approvalsReviewer: 'user', sandbox: 'danger-full-access' }, turn: { approvalPolicy: 'never', approvalsReviewer: 'user', sandboxPolicy: { type: 'dangerFullAccess' } } }
    : { level, thread: { approvalPolicy: 'on-request', approvalsReviewer: level === 'auto' ? 'auto_review' : 'user', sandbox: 'workspace-write' }, turn: { approvalPolicy: 'on-request', approvalsReviewer: level === 'auto' ? 'auto_review' : 'user', sandboxPolicy: { type: 'workspaceWrite', writableRoots: [], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false } } }
}
