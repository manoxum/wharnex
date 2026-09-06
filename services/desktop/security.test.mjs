import test from 'node:test'
import assert from 'node:assert/strict'
import { chatGPTNavigationDisposition, chatInputSettleDelay, chromeCompatibleUserAgent, contextBundleURL, decodeUserAttachment, externalAuthProvider, isChatGPTAuthURL, isTrustedChatGPTOrigin, normalizeBounds, requireLocalHTTPURL, requireTrustedChatGPTURL, resolveLinuxOzonePlatform, sanitizeAttachmentFilename, sanitizeChatCacheKey, sanitizeChatGPTAuthMode, sanitizeDiagnosticURL, sanitizeSessionId, canonicalWharnessBundleDownload, validateWharnessBundleDownload, validateWharnessPlanFile, wharnessBundleRequestIdFromFilename, wharnessPlanRequestIdFromFilename } from './security.mjs'

test('session ids are strictly allowlisted', () => {
  assert.equal(sanitizeSessionId('ses_20260902_abc-123'), 'ses_20260902_abc-123')
  assert.throws(() => sanitizeSessionId('../etc/passwd'))
})

test('frontend/backend URLs must remain local HTTP', () => {
  assert.equal(requireLocalHTTPURL('http://127.0.0.1:8080').port, '8080')
  assert.throws(() => requireLocalHTTPURL('https://evil.example'))
  assert.throws(() => requireLocalHTTPURL('file:///tmp/x'))
})

test('context bundle URL is generated internally', () => {
  assert.equal(contextBundleURL('http://127.0.0.1:8080', 'ses_abc'), 'http://127.0.0.1:8080/api/sessions/ses_abc/bundle')
})

test('native view bounds are clamped to window content', () => {
  assert.deepEqual(normalizeBounds({ x: -5, y: 12, width: 900, height: 900 }, { width: 500, height: 400 }), { x: 0, y: 12, width: 500, height: 388 })
  assert.deepEqual(normalizeBounds({ x: 999, y: 999, width: 20, height: 20 }, { width: 500, height: 400 }), { x: 499, y: 399, width: 1, height: 1 })
})

test('Linux ozone selection prefers X11 when XWayland is available', () => {
  assert.equal(resolveLinuxOzonePlatform({ DISPLAY: ':0', WAYLAND_DISPLAY: 'wayland-0' }), 'x11')
  assert.equal(resolveLinuxOzonePlatform({ WHARNESS_OZONE_PLATFORM: 'wayland', DISPLAY: ':0' }), 'wayland')
  assert.equal(resolveLinuxOzonePlatform({ WAYLAND_DISPLAY: 'wayland-0' }), 'wayland')
})


test('external OAuth providers are identified for system-browser routing', () => {
  assert.equal(externalAuthProvider('https://auth.openai.com/log-in'), 'OpenAI')
  assert.equal(externalAuthProvider('https://auth0.openai.com/authorize'), 'OpenAI')
  assert.equal(externalAuthProvider('https://accounts.google.com/o/oauth2/v2/auth'), 'Google')
  assert.equal(externalAuthProvider('https://login.microsoftonline.com/common/oauth2/v2.0/authorize'), 'Microsoft')
  assert.equal(externalAuthProvider('https://appleid.apple.com/auth/authorize'), 'Apple')
  assert.equal(externalAuthProvider('https://chatgpt.com/'), '')
  assert.equal(externalAuthProvider('javascript:alert(1)'), '')
})




test('ChatGPT navigation distinguishes ChatGPT auth, provider auth and ordinary links', () => {
  assert.deepEqual(chatGPTNavigationDisposition('https://chatgpt.com/auth/login'), { kind: 'chatgpt-auth', provider: 'OpenAI' })
  assert.deepEqual(chatGPTNavigationDisposition('https://auth.openai.com/log-in'), { kind: 'external-auth', provider: 'OpenAI' })
  assert.deepEqual(chatGPTNavigationDisposition('https://accounts.google.com/o/oauth2/v2/auth'), { kind: 'external-auth', provider: 'Google' })
  assert.deepEqual(chatGPTNavigationDisposition('https://example.com/docs'), { kind: 'external', provider: '' })
  assert.deepEqual(chatGPTNavigationDisposition('javascript:alert(1)'), { kind: 'deny', provider: '' })
})


test('ChatGPT authentication mode is strict and auth paths are recognized', () => {
  assert.equal(sanitizeChatGPTAuthMode('embedded'), 'embedded')
  assert.equal(sanitizeChatGPTAuthMode('external'), 'external')
  assert.throws(() => sanitizeChatGPTAuthMode('system'))
  assert.equal(isChatGPTAuthURL('https://chatgpt.com/auth/login'), true)
  assert.equal(isChatGPTAuthURL('https://chatgpt.com/auth/callback/openai'), true)
  assert.equal(isChatGPTAuthURL('https://chatgpt.com/c/abc'), false)
})

test('ChatGPT compatibility user agent exposes Chrome without Electron token', () => {
  const ua = chromeCompatibleUserAgent('linux', '152.0.7977.65')
  assert.match(ua, /Chrome\/152\.0\.7977\.65/)
  assert.doesNotMatch(ua, /Electron/i)
})

test('diagnostic URLs omit query strings and fragments', () => {
  assert.equal(
    sanitizeDiagnosticURL('https://chatgpt.com/backend-api/conversation?token=secret#frag'),
    'https://chatgpt.com/backend-api/conversation',
  )
})


test('clipboard permission origin is restricted to ChatGPT HTTPS', () => {
  assert.equal(isTrustedChatGPTOrigin('https://chatgpt.com/c/abc'), true)
  assert.equal(isTrustedChatGPTOrigin('https://foo.chatgpt.com/path'), true)
  assert.equal(isTrustedChatGPTOrigin('http://chatgpt.com/'), false)
  assert.equal(isTrustedChatGPTOrigin('https://chatgpt.com.evil.example/'), false)
  assert.equal(isTrustedChatGPTOrigin('https://openai.com/'), false)
  assert.equal(isTrustedChatGPTOrigin('javascript:alert(1)'), false)
})


test('ChatGPT navigation URLs are restricted to the trusted remote surface', () => {
  assert.equal(requireTrustedChatGPTURL('https://chatgpt.com/c/abc'), 'https://chatgpt.com/c/abc')
  assert.throws(() => requireTrustedChatGPTURL('https://chatgpt.com.evil.example/c/abc'))
  assert.throws(() => requireTrustedChatGPTURL('http://chatgpt.com/c/abc'))
  assert.throws(() => requireTrustedChatGPTURL('https://user:secret@chatgpt.com/c/abc'))
})


test('Wharness plan filenames are strict and expose the request id', () => {
  assert.equal(wharnessPlanRequestIdFromFilename('wharness-plan-req_20260902T222529_d18d51d84abc677c.json'), 'req_20260902T222529_d18d51d84abc677c')
  assert.equal(wharnessPlanRequestIdFromFilename('plan.json'), '')
  assert.equal(wharnessPlanRequestIdFromFilename('wharness-plan-../../evil.json'), '')
})

test('downloaded plan JSON must match filename request id and protocol', () => {
  const filename = 'wharness-plan-req_20260902T222529_d18d51d84abc677c.json'
  const valid = JSON.stringify({ protocol: 'harness.execution/v1', request_id: 'req_20260902T222529_d18d51d84abc677c' })
  assert.equal(validateWharnessPlanFile(filename, valid).requestId, 'req_20260902T222529_d18d51d84abc677c')
  assert.throws(() => validateWharnessPlanFile(filename, '{bad json'))
  assert.throws(() => validateWharnessPlanFile(filename, JSON.stringify({ protocol: 'other', request_id: 'req_20260902T222529_d18d51d84abc677c' })))
  assert.throws(() => validateWharnessPlanFile(filename, JSON.stringify({ protocol: 'harness.execution/v1', request_id: 'req_other_12345678' })))
})


test('ChatGPT DOM cache keys are local identifiers only', () => {
  assert.equal(sanitizeChatCacheKey('c6c0810a-1234-4abc-a123-1234567890ab'), 'c6c0810a-1234-4abc-a123-1234567890ab')
  assert.throws(() => sanitizeChatCacheKey('../escape'))
  assert.throws(() => sanitizeChatCacheKey(''))
})

test('user attachment filenames and payloads cannot escape the temp directory', () => {
  assert.equal(sanitizeAttachmentFilename('requirements (final).pdf'), 'requirements (final).pdf')
  assert.throws(() => sanitizeAttachmentFilename('../secret'))
  assert.throws(() => sanitizeAttachmentFilename('folder/file.txt'))
  assert.throws(() => sanitizeAttachmentFilename('bad\u0000name'))
  assert.throws(() => sanitizeAttachmentFilename('CON.txt'))
  assert.throws(() => sanitizeAttachmentFilename('bad:name.txt'))
  const decoded = decodeUserAttachment({ name: 'note.txt', mime: 'text/plain', contentBase64: Buffer.from('hello').toString('base64') }, 10)
  assert.equal(decoded.name, 'note.txt')
  assert.equal(decoded.mime, 'text/plain')
  assert.equal(decoded.bytes.toString(), 'hello')
  assert.throws(() => decodeUserAttachment({ name: 'large.bin', contentBase64: Buffer.from('too large').toString('base64') }, 2))
  assert.throws(() => decodeUserAttachment({ name: 'bad.bin', contentBase64: '%%%=' }, 10))
  assert.throws(() => decodeUserAttachment({ name: 'bad.bin', mime: 'text/plain; charset=utf-8', contentBase64: Buffer.from('ok').toString('base64') }, 10))
})

test('automatic ChatGPT submission waits longer for larger attachment sets and remains bounded', () => {
  assert.equal(chatInputSettleDelay(0, 0), 1500)
  assert.ok(chatInputSettleDelay(25 * 1024 * 1024, 2) > chatInputSettleDelay(1024, 1))
  assert.equal(chatInputSettleDelay(1024 * 1024 * 1024, 100), 30_000)
})


test('Wharness execution bundle filenames are strict and ZIP bytes are checked', () => {
  const name = 'whx_bundle_res_chat_req_20260903T005500_abcdef1234567890.zip'
  assert.equal(wharnessBundleRequestIdFromFilename(name), 'req_20260903T005500_abcdef1234567890')
  assert.equal(validateWharnessBundleDownload(name, Uint8Array.from([0x50, 0x4b, 0x03, 0x04])).requestId, 'req_20260903T005500_abcdef1234567890')
  assert.throws(() => validateWharnessBundleDownload(name, Uint8Array.from([1, 2, 3, 4])))
  assert.equal(wharnessBundleRequestIdFromFilename('bundle.zip'), '')
})


test('generic ChatGPT ZIP names normalize only against the active expected request', () => {
  const requestId = 'req_20260903T112307_7f79e5fe040d3e2d'
  assert.deepEqual(canonicalWharnessBundleDownload('Baixar o bundle Wharness.zip', requestId, 'application/zip'), {
    requestId,
    filename: `whx_bundle_res_chat_${requestId}.zip`,
    normalized: true,
    sourceFilename: 'Baixar o bundle Wharness.zip',
  })
  assert.equal(canonicalWharnessBundleDownload('notes.pdf', requestId, 'application/pdf'), undefined)
  assert.throws(() => canonicalWharnessBundleDownload('whx_bundle_res_chat_req_20260903T112307_a1a1a1a1a1a1a1a1.zip', requestId, 'application/zip'), /pedido ativo/)
  assert.throws(() => canonicalWharnessBundleDownload('wharness-bundle-wrong.zip', requestId, 'application/zip'), /não pode ser normalizado/)
})

test('Chromium duplicate suffix normalizes only when the embedded bundle request is active', () => {
  const requestId = 'req_20260905T225921_c0e570d71b7c6819'
  for (const sourceFilename of [
    `whx_bundle_res_chat_${requestId}(1).zip`,
    `whx_bundle_res_chat_${requestId} (2).zip`,
  ]) {
    assert.deepEqual(canonicalWharnessBundleDownload(sourceFilename, requestId, 'application/zip'), {
      requestId,
      filename: `whx_bundle_res_chat_${requestId}.zip`,
      normalized: true,
      sourceFilename,
    })
  }
  assert.throws(
    () => canonicalWharnessBundleDownload('whx_bundle_res_chat_req_20260905T225921_b2b2b2b2b2b2b2b2(1).zip', requestId, 'application/zip'),
    /pedido ativo/,
  )
})
