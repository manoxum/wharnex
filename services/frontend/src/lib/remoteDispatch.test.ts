import { beforeEach, describe, expect, it, vi } from 'vitest'
import { request } from './api'
import { queueRemotePrompt } from './remoteDispatch'

vi.mock('./api', () => ({ request: vi.fn() }))

describe('queueRemotePrompt', () => {
  beforeEach(() => vi.mocked(request).mockReset())

  it('queues the prepared prompt for a Desktop Supervisor instead of a browser in the web app', async () => {
    vi.mocked(request).mockResolvedValue({ task_id: 'task-remote' } as never)

    const result = await queueRemotePrompt({
      chatId: 'chat-1',
      sessionId: 'session-1',
      requestId: 'req-1',
      projectPath: '/workspace/demo',
      conversationUrl: 'https://chatgpt.com/c/demo',
      prompt: {
        text: 'Run this planner request',
        requestId: 'req-1',
        sessionId: 'session-1',
        workspaceChatId: 'chat-1',
        includeContext: true,
        autoSubmit: true,
      },
    })

    expect(request).toHaveBeenCalledTimes(1)
    const [path, init] = vi.mocked(request).mock.calls[0]
    expect(path).toBe('/api/chat-agent/tasks')
    expect(init?.method).toBe('POST')
    const body = JSON.parse(String(init?.body))
    expect(body.type).toBe('BOT_WRITE')
    expect(body.chat_id).toBe('chat-1')
    expect(body.request_id).toBe('req-1')
    expect(body.project_id).toBe('/workspace/demo')
    expect(body.payload.operation).toBe('PREPARE_PROMPT')
    expect(body.payload.request.text).toBe('Run this planner request')
    expect(body.payload.request.autoSubmit).toBe(true)
    expect(result).toEqual({
      queued: true,
      taskId: 'task-remote',
      attachmentCount: 1,
      submitted: true,
      includedContext: true,
      conversationUrl: 'https://chatgpt.com/c/demo',
    })
  })
})
