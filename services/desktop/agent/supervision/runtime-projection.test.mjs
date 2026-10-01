import test from 'node:test'
import assert from 'node:assert/strict'
import { chatAgentAgentProject, publicAgentBrowser, publicChatAgentTask, unavailableAgentBrowser } from './runtime-projection.mjs'

test('task projection retains durable ownership and bounded status fields', () => {
  const task = publicChatAgentTask({
    task_id: 42, project_id: 'project-a', chat_id: 'chat-a', status: 'RUNNING',
    attempt: -3, max_attempts: 4, keep_flowing: true, payload: { secret: 'hidden' },
  })
  assert.equal(task.project_id, 'project-a')
  assert.equal(task.chat_id, 'chat-a')
  assert.equal(task.attempt, 0)
  assert.equal(task.keep_flowing, true)
  assert.equal('payload' in task, false)
  assert.equal(publicChatAgentTask(undefined), undefined)
})

test('project ownership uses last task only while a slot stays engaged', () => {
  assert.equal(chatAgentAgentProject({ project_id: 'current' }, { project_id: 'old' }, true), 'current')
  assert.equal(chatAgentAgentProject(undefined, { project_id: 'old' }, true), 'old')
  assert.equal(chatAgentAgentProject(undefined, { project_id: 'old' }, false), '')
})

test('browser projection fails closed if WebContents retires during a snapshot', () => {
  const unavailable = unavailableAgentBrowser()
  assert.deepEqual(publicAgentBrowser(undefined, (url) => url), unavailable)
  const entry = { view: { webContents: { isDestroyed: () => false, getURL: () => { throw new Error('closed') } } } }
  assert.deepEqual(publicAgentBrowser(entry, (url) => url), unavailable)
})

test('browser projection sanitizes the URL and survives process ID read failure', () => {
  const entry = { loading: true, view: { webContents: {
    id: 7, isDestroyed: () => false, getURL: () => 'https://chatgpt.com/c/id?private=1',
    getOSProcessId: () => { throw new Error('closed') }, getTitle: () => 'ChatGPT',
  } } }
  const browser = publicAgentBrowser(entry, () => 'https://chatgpt.com/c/id')
  assert.deepEqual(browser, {
    available: true, web_contents_id: 7, os_process_id: 0,
    url: 'https://chatgpt.com/c/id', title: 'ChatGPT', loading: true,
  })
})
