import { expect, test } from '@playwright/test'

const config = { planner: 'manual', sandbox: 'docker', model: 'gpt-5.6-sol', api_configured: false, chatgpt_web_embed: false }

test('renders project bootstrap screen', async ({ page }) => {
  await page.route('**/api/config', async (route) => route.fulfill({ json: config }))
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /Editor e agente/i })).toBeVisible()
  await expect(page.getByLabel('Diretório do projeto')).toBeVisible()
})

test('workspace opens in editor and can switch to agent/chatgpt', async ({ page }) => {
  const baseSession = {
    id: 'ses_test', project_path: '/tmp/demo', state: 'ready', created_at: new Date().toISOString(),
    context: { id: 'ctx_test', manifest: { id: 'ctx_test', project_root: '/tmp/demo', sha256: 'abcdef1234567890', files: [{ path: 'hello.txt', size: 4, sha256: 'x' }], excluded: [], text_truncated: false } },
  }
  const planned = {
    ...baseSession,
    state: 'planned',
    last_request_id: 'req_test',
    plan: { protocol: 'harness.execution/v1', plan_id: 'p1', request_id: 'req_test', status: 'ready', summary: 'Atualiza hello.txt', risk: 'low', requires_approval: false, operations: [], verification: [] },
    policy: { allowed: true, requires_approval: false, risk: 'low', reasons: [] },
  }
  await page.route('**/api/config', (route) => route.fulfill({ json: config }))
  await page.route('**/api/sessions', async (route) => {
    if (route.request().method() === 'POST') await route.fulfill({ json: baseSession })
    else await route.fallback()
  })
  await page.route('**/api/sessions/ses_test/events', (route) => route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' }))
  await page.route('**/api/sessions/ses_test/files', (route) => route.fulfill({ json: { files: [{ path: 'hello.txt', name: 'hello.txt', kind: 'file', size: 4 }] } }))
  await page.route('**/api/sessions/ses_test/messages', (route) => route.fulfill({ json: { session: { ...baseSession, last_request_id: 'req_test' }, manual_prompt: 'PROMPT MANUAL req_test' } }))
  await page.route('**/api/sessions/ses_test/manual-plan', (route) => route.fulfill({ json: planned }))

  await page.goto('/')
  await page.getByLabel('Diretório do projeto').fill('/tmp/demo')
  await page.getByRole('button', { name: /Abrir projeto/i }).click()
  await expect(page.getByText('Explorer')).toBeVisible()
  await page.getByRole('button', { name: /Agent/i }).click()
  await page.getByPlaceholder(/Descreva a alteração/i).fill('Atualize hello.txt')
  await page.getByLabel('Enviar').click()
  await page.getByRole('button', { name: /ChatGPT/i }).click()
  await expect(page.getByText('PROMPT MANUAL req_test')).toBeVisible()
  await page.getByLabel('Plano JSON recebido').fill(JSON.stringify(planned.plan))
  await page.getByRole('button', { name: /Validar plano no Harness/i }).click()
  await page.getByRole('button', { name: /^Plano$/i }).click()
  await expect(page.getByText('Atualiza hello.txt')).toBeVisible()
})

test('reload restores active workspace', async ({ page }) => {
  const session = {
    id: 'ses_restore', project_path: '/tmp/restore', state: 'ready', created_at: new Date().toISOString(),
    context: { id: 'ctx_restore', manifest: { id: 'ctx_restore', project_root: '/tmp/restore', sha256: 'abc', files: [], excluded: [], text_truncated: false } },
  }
  await page.addInitScript((value) => localStorage.setItem('kernl.workspace.active.v1', JSON.stringify(value)), { sessionId: 'ses_restore', projectPath: '/tmp/restore', mode: 'agent' })
  await page.route('**/api/config', (route) => route.fulfill({ json: config }))
  await page.route('**/api/sessions/ses_restore', (route) => route.fulfill({ json: session }))
  await page.route('**/api/sessions/ses_restore/events', (route) => route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' }))
  await page.goto('/')
  await expect(page.getByText('/tmp/restore')).toBeVisible()
  await expect(page.getByPlaceholder(/Descreva a alteração/i)).toBeVisible()
})
