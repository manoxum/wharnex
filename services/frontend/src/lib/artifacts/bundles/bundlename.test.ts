import { describe, expect, it } from 'vitest'
import { expectedResponseBundleName, parseBundleName, parseBundleNameWithDuplicateSuffix, requestIdFromBundleName } from './bundlename'

const chatId = '9f3a2b1c-uuid-like'
const rootReq = 'req_20260906T192238_1adfea24039ba474'
const derivedId = 'req_20260906T193501_a512a09f68dd0c96'

describe('bundlename parsing', () => {
  it('parses a main-request bundle name', () => {
    const name = `whx_bundle_req_${chatId}_${rootReq}.zip`
    expect(parseBundleName(name)).toEqual({ kind: 'req', chatId, requestId: rootReq, subrequestId: '' })
    expect(requestIdFromBundleName(name)).toBe(rootReq)
  })

  it('parses a derived-request bundle name and prefers the subrequest id', () => {
    const name = `whx_bundle_res_${chatId}_${rootReq}_${derivedId}.zip`
    expect(parseBundleName(name)).toEqual({ kind: 'res', chatId, requestId: rootReq, subrequestId: derivedId })
    expect(requestIdFromBundleName(name)).toBe(derivedId)
  })

  it('rejects names outside the scheme', () => {
    for (const bad of [
      'wharness-bundle-req_20260906T192238_1adfea24039ba474.zip',
      `whx_bundle_bad_${chatId}_${rootReq}.zip`,
      `whx_bundle_req_${chatId}_not-a-request-id.zip`,
      '',
    ]) {
      expect(parseBundleName(bad)).toBeNull()
    }
  })

  it('tolerates a browser duplicate-download suffix', () => {
    const name = `whx_bundle_res_${chatId}_${rootReq} (2).zip`
    expect(parseBundleName(name)).toBeNull()
    expect(parseBundleNameWithDuplicateSuffix(name)).toEqual({ kind: 'res', chatId, requestId: rootReq, subrequestId: '' })
    expect(requestIdFromBundleName(name)).toBe(rootReq)
  })

  it('extracts only the exact response filename for the active request', () => {
    const expected = `whx_bundle_res_${chatId}_${rootReq}_${derivedId}.zip`
    const prompt = `Return ${expected}; ignore whx_bundle_res_${chatId}_${rootReq}.zip for this derived turn.`
    expect(expectedResponseBundleName(prompt, derivedId)).toBe(expected)
    expect(expectedResponseBundleName(prompt, 'req_20260906T194500_0000000000000000')).toBe('')
  })
})
