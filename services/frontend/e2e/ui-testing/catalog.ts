import type { UITestingDocument } from '../../src/types'

export const catalog: UITestingDocument = {
  project_id: '/demo', sync_status: 'ready', auto_run_changes: true,
  environments: [
    { id: 'portal', name: 'DRCAE Portal', description: 'Portal público e área autenticada para denúncias, validação documental e serviços online.', url: 'https://portal.example.test', profiles: [{ id: 'citizen', label: 'Cidadão', role: 'Utilizador autenticado do portal', configured: true }] },
    { id: 'admin', name: 'DRCAE Admin', description: 'Gestão de processos e operações.', url: 'https://admin.example.test', profiles: [] },
  ],
  tests: [
    { id: 'landing', title: 'Abrir a página pública', description: 'Verificar a navegação e o acesso aos serviços do portal.', goal: 'Abrir', environment_id: 'portal', access: 'public', status: 'passed', category: 'smoke' },
    { id: 'document', title: 'Validar um documento emitido', description: 'Confirmar a autenticidade do documento pelo seu identificador.', goal: 'Validar', environment_id: 'portal', access: 'public', status: 'queued', category: 'functional' },
    { id: 'register', title: 'Validar o registo de cidadão', description: 'Validar campos obrigatórios e mensagens de confirmação.', goal: 'Registar', environment_id: 'portal', profile_id: 'citizen', status: 'waiting', category: 'validation', steps: [{ action: 'Preencher o formulário', expected: 'Campos válidos' }] },
    { id: 'reject', title: 'Exigir motivo ao rejeitar livro', description: 'A rejeição exige uma justificação explícita.', goal: 'Rejeitar', environment_id: 'admin', access: 'public', status: 'failed', category: 'functional', last_run_id: 'run_reject' },
  ],
  runs: [{ id: 'run_reject', test_id: 'reject', status: 'failed', error: 'O formulário não apresentou a validação esperada.', started_at: '2026-10-06T10:00:00Z' }],
  guides: [
    { id: 'g1', test_id: 'landing', run_id: 'run_landing', title: 'Abrir a página pública', markdown: '## Para que serve\n\nAceder aos serviços públicos do portal.\n\n## Passo a passo\n\n1. Abra o portal no navegador.\n2. Escolha o serviço pretendido.\n\n## Resultado esperado\n\nOs serviços estão disponíveis sem iniciar sessão.', pdf_ready: true, updated_at: '' },
    { id: 'g2', test_id: 'document', run_id: 'run_document', title: 'Validar um documento emitido', markdown: '## Para que serve\n\nConfirmar a autenticidade de um documento.\n\n## Passo a passo\n\n1. Abra a validação documental.\n2. Introduza o identificador do documento.\n3. Consulte o resultado.', pdf_ready: false, updated_at: '' },
  ],
}
