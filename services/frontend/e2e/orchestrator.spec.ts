import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'

const config = { planner: 'manual', sandbox: 'docker', model: 'gpt-5.6-sol', api_configured: false, chatgpt_web_embed: false }
const session = {
  id: 'ses_orchestrator', project_path: '/tmp/orchestrator', state: 'ready', execution_mode: 'protected', automation_mode: 'auto', chat_transport_mode: 'scraper', effort_level: 'high', created_at: '2026-09-28T08:00:00Z',
  context: { id: 'ctx_orchestrator', manifest: { id: 'ctx_orchestrator', project_root: '/tmp/orchestrator', sha256: 'abc', files: [], excluded: [], text_truncated: false } },
}
const task = (id: string, status: string, allowed: string[] = [], title = id) => ({
  id, project_path: session.project_path, title, status, condition: 'none', priority: 'normal', parallelizable: false,
  allowed_transitions: allowed, was_completed: status === 'COMPLETE' || status === 'ARCHIVED', created_at: '2026-09-28T08:00:00Z', updated_at: '2026-09-28T08:00:00Z',
})

test('keeps the Orchestrator terminal flow accessible in a narrow viewport', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 640, height: 760 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.addInitScript((value) => localStorage.setItem('kernl.workspace.active.v1', JSON.stringify(value)), { sessionId: session.id, projectPath: session.project_path, mode: 'orchestrator' })
  const createdSession = { ...session, id: 'ses_task_chat' }
  let createdSessionInput: Record<string, unknown> = {}
  await page.route('**/api/config', (route) => route.fulfill({ json: config }))
  await page.route('**/api/sessions', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    createdSessionInput = await route.request().postDataJSON()
    return route.fulfill({ json: createdSession })
  })
  await page.route(`**/api/sessions/${createdSession.id}/events`, (route) => route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' }))
  await page.route('**/api/workspace-chats/*', async (route) => route.fulfill({ json: await route.request().postDataJSON() }))
  await page.route(`**/api/sessions/${session.id}`, (route) => route.fulfill({ json: session }))
  await page.route(`**/api/sessions/${session.id}/events`, (route) => route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' }))
  await page.route('**/api/chat-agent/tasks?*', (route) => route.fulfill({ json: { tasks: [] } }))
  await page.route(`**/api/sessions/${session.id}/orchestrator/overview`, (route) => route.fulfill({ json: {
    plans: [{ id: 'opl-live', project_path: session.project_path, title: 'Plano ativo', objective: 'Validar Orchestrator', status: 'ACTIVE', created_at: '2026-09-28T08:00:00Z', updated_at: '2026-09-28T08:00:00Z' }],
    tasks: [task('Pending task', 'PENDING', ['READY', 'ARCHIVED']), task('Ready task', 'READY', ['PENDING', 'ARCHIVED'])],
    task_counts: { PENDING: 1, WAITING: 0, READY: 1, DOING: 0, REVIEW: 0, COMPLETE: 2, FAILED: 0, ARCHIVED: 2 }, planning_requests: [], mutation_slots: 1, mutation_slots_used: 0,
  } }))
  await page.route(`**/api/sessions/${session.id}/orchestrator/tasks?*`, (route) => {
    const url = new URL(route.request().url())
    const status = url.searchParams.get('status')
    const cursor = url.searchParams.get('cursor')
    if (status === 'COMPLETE' && cursor) return route.fulfill({ json: { tasks: [task('complete-second', 'COMPLETE', ['ARCHIVED'], 'Complete second')], total: 2, has_more: false } })
    if (status === 'COMPLETE') return route.fulfill({ json: { tasks: [task('complete-first', 'COMPLETE', ['ARCHIVED'], 'Complete first')], total: 2, has_more: true, next_cursor: 'complete-next' } })
    if (status === 'ARCHIVED' && cursor) return route.fulfill({ json: { tasks: [task('archived-second', 'ARCHIVED', [], 'Archived second')], total: 2, has_more: false } })
    return route.fulfill({ json: { tasks: [task('archived-first', 'ARCHIVED', [], 'Archived first')], total: 2, has_more: true, next_cursor: 'archived-next' } })
  })
  let transitioned = ''
  await page.route(`**/api/sessions/${session.id}/orchestrator/tasks/Ready%20task/transition`, async (route) => {
    transitioned = (await route.request().postDataJSON()).status
    await route.fulfill({ json: task('Ready task', transitioned, transitioned === 'PENDING' ? ['READY', 'ARCHIVED'] : []) })
  })
  await page.route(`**/api/sessions/${session.id}/orchestrator/tasks/complete-first/transition`, async (route) => {
    const input = await route.request().postDataJSON()
    expect(input.status).toBe('ARCHIVED')
    await route.fulfill({ json: task('complete-first', 'ARCHIVED', [], 'Complete first') })
  })

  await page.goto('/')
  await expect(page.getByRole('navigation', { name: 'Orchestrator' })).toBeVisible()
  await page.getByRole('button', { name: /Tasks/ }).click()
  const complete = page.getByRole('region', { name: /Coluna COMPLETE/ })
  const archived = page.getByRole('region', { name: /Coluna ARCHIVED/ })
  await expect(page.getByRole('region', { name: 'Coluna COMPLETE, 2 tarefas' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Coluna ARCHIVED, 2 tarefas' })).toBeVisible()
  const track = page.getByTestId('orchestrator-kanban-scroll').locator(':scope > div')
  await expect(track).toHaveCSS('flex-wrap', 'nowrap')
  await expect(page.getByTestId('orchestrator-kanban-scroll')).toHaveCSS('scroll-behavior', 'auto')
  const completeBox = await complete.boundingBox()
  const pendingBox = await page.getByRole('region', { name: /Coluna PENDING/ }).boundingBox()
  expect(Math.abs((completeBox?.y ?? 0) - (pendingBox?.y ?? 0))).toBeLessThan(2)

  const next = page.getByRole('button', { name: 'Ver coluna seguinte' })
  await next.focus()
  await expect(next).toBeFocused()
  await next.press('Enter')
  await expect.poll(() => page.getByTestId('orchestrator-kanban-scroll').evaluate((node) => node.scrollLeft)).toBeGreaterThan(0)

  await complete.getByRole('button', { name: 'Ações de Complete first' }).click()
  await expect(page.getByRole('menuitem', { name: 'Arquivar' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: /Mover para READY|Reabrir/i })).toHaveCount(0)
  await page.getByRole('menuitem', { name: 'Arquivar' }).click()
  await expect(archived.getByText('Complete first')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Coluna ARCHIVED, 3 tarefas' })).toBeVisible()
  await complete.getByRole('button', { name: 'Carregar mais' }).click()
  await expect(complete.getByText('Complete second')).toBeVisible()
  await archived.getByRole('button', { name: 'Carregar mais' }).click()
  await expect(archived.getByText('Archived second')).toBeVisible()

  await page.getByText('Ready task').locator('..').dragTo(page.getByRole('region', { name: /Coluna PENDING/ }))
  await expect.poll(() => transitioned).toBe('PENDING')

  const baseline = resolve(process.cwd(), '../../docs/orchestrator-test/kanban-before.png')
  expect(existsSync(baseline)).toBeTruthy()
  await testInfo.attach('kanban-before', { path: baseline, contentType: 'image/png' })
  await testInfo.attach('kanban-current', { body: await page.screenshot(), contentType: 'image/png' })

  await archived.getByRole('button', { name: 'Ações de Complete first' }).click()
  await archived.getByRole('menuitem', { name: 'Abrir chat' }).click()
  await expect(page.getByPlaceholder(/Pergunte, analise/)).toHaveValue('@{[task]complete-first}')
  expect(createdSessionInput.project_path).toBe(session.project_path)
  expect(String(createdSessionInput.chat_id || '')).not.toBe('')
})


test('keeps the orchestration phase aligned with approval, execution, review, and completion', async ({ page }) => {
  const requestId = 'orp-phase-cycle'
  const planId = 'opl-phase-cycle'
  const objective = 'Fluxo integrado da orquestração'
  let phase: 'AWAITING_APPROVAL' | 'EXECUTING' | 'REVIEW' | 'COMPLETED' = 'AWAITING_APPROVAL'
  let planStatus: 'DRAFT' | 'ACTIVE' | 'COMPLETED' = 'DRAFT'
  let statuses = ['PENDING', 'PENDING', 'PENDING']

  const overview = () => {
    const counts = { PENDING: 0, WAITING: 0, READY: 0, DOING: 0, REVIEW: 0, COMPLETE: 0, FAILED: 0, ARCHIVED: 0 }
    statuses.forEach((status) => { counts[status as keyof typeof counts] += 1 })
    return {
      plans: [{ id: planId, project_path: session.project_path, title: 'Plano de fases', objective, status: planStatus, planner_request_id: requestId, created_at: '2026-09-29T18:00:00Z', updated_at: '2026-09-29T18:00:00Z' }],
      tasks: statuses.map((status, index) => task(`phase-task-${index + 1}`, status, [], `Phase task ${index + 1}`)).map((item) => ({ ...item, plan_id: planId })),
      task_counts: counts,
      planning_requests: [{ request_id: requestId, task_id: 'planner-worker-task', objective, status: 'DONE', phase, attempt: 1, max_attempts: 15, created_at: '2026-09-29T18:00:00Z', updated_at: '2026-09-29T18:00:00Z' }],
      mutation_slots: 1,
      mutation_slots_used: 0,
    }
  }
  const detail = () => ({
    request_id: requestId,
    task_id: 'planner-worker-task',
    status: 'DONE',
    attempt: 1,
    max_attempts: 15,
    objective,
    include_context: true,
    project_files: [],
    attachments: [],
    attempts: [],
    plan: overview().plans[0],
    tasks: overview().tasks.map((item) => ({ task: item, runs: [] })),
  })

  await page.addInitScript((value) => localStorage.setItem('kernl.workspace.active.v1', JSON.stringify(value)), { sessionId: session.id, projectPath: session.project_path, mode: 'orchestrator' })
  await page.route('**/api/config', (route) => route.fulfill({ json: config }))
  await page.route(`**/api/sessions/${session.id}`, (route) => route.fulfill({ json: session }))
  await page.route(`**/api/sessions/${session.id}/events`, (route) => route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' }))
  await page.route('**/api/chat-agent/tasks?*', (route) => route.fulfill({ json: { tasks: [] } }))
  await page.route(`**/api/sessions/${session.id}/orchestrator/overview`, (route) => route.fulfill({ json: overview() }))
  await page.route(`**/api/sessions/${session.id}/orchestrator/planning/${requestId}`, (route) => route.fulfill({ json: detail() }))
  await page.route(`**/api/sessions/${session.id}/orchestrator/plans/${planId}/approve`, async (route) => {
    planStatus = 'ACTIVE'
    phase = 'EXECUTING'
    statuses = ['COMPLETE', 'REVIEW', 'READY']
    await route.fulfill({ json: overview() })
  })

  await page.goto('/')
  const planningCard = page.locator('article').filter({ hasText: objective })
  await expect(planningCard).toBeVisible()
  await expect(planningCard.getByText('Em análise', { exact: true })).toBeVisible()
  await expect(planningCard.getByText('Concluído', { exact: true })).toHaveCount(0)

  await page.getByRole('button', { name: `Abrir detalhe de ${objective}` }).click()
  await expect(page.getByRole('button', { name: /Aprovar plano/ })).toBeVisible()
  await page.getByRole('button', { name: /Aprovar plano/ }).click()
  await expect(planningCard.getByText('Em execução', { exact: true })).toBeVisible()

  for (const blockingStatus of ['READY', 'DOING', 'FAILED']) {
    statuses = ['COMPLETE', 'REVIEW', blockingStatus]
    phase = 'EXECUTING'
    await page.getByRole('button', { name: 'Atualizar Orchestrator' }).click()
    await expect(planningCard.getByText('Em execução', { exact: true })).toBeVisible()
    await expect(planningCard.getByText('Review', { exact: true })).toHaveCount(0)
  }

  statuses = ['COMPLETE', 'REVIEW', 'REVIEW']
  phase = 'REVIEW'
  await page.getByRole('button', { name: 'Atualizar Orchestrator' }).click()
  await expect(planningCard.getByText('Review', { exact: true })).toBeVisible()

  statuses = ['COMPLETE', 'COMPLETE', 'COMPLETE']
  phase = 'COMPLETED'
  planStatus = 'COMPLETED'
  await page.getByRole('button', { name: 'Atualizar Orchestrator' }).click()
  await expect(planningCard.getByText('Concluído', { exact: true })).toBeVisible()
})
