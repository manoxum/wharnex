import path from 'node:path'

const BUNDLE_NAME = /^whx_(?:bundle|translation|release_notes|todo_classification|ui_test_(?:discovery|step|guide))_(?:req|res)_[a-zA-Z0-9_-]+\.zip$/
const TASK_ID = /cat_[a-f0-9]{20}/
const MAX_BUNDLE_BYTES = 16 * 1024 * 1024
const observed = new WeakSet()

export function bundleUploadMetadata(filePath) {
  const name = path.basename(String(filePath || ''))
  if (name.length > 250 || !BUNDLE_NAME.test(name)) return ''
  const task = TASK_ID.exec(name)?.[0]
  return ` name=${name}${task ? ` task=${task}` : ''}`
}

// Called only after an existing owned-download route accepts the item. The
// observer records metadata and never reads bytes or changes download state.
export function observeBundleDownload(item, sourceFilename, log = console.log) {
  if (!item || typeof item.once !== 'function') return
  const filename = path.basename(String(sourceFilename || '')).replace(/ \([1-9][0-9]{0,3}\)(?=\.zip$)/, '')
  if (filename.length > 250 || !BUNDLE_NAME.test(filename) || !filename.includes('_res_') || observed.has(item)) return
  observed.add(item)
  try {
    item.once('done', (_event, state) => {
      if (state !== 'completed') return
      try {
        const bytes = Number(item.getReceivedBytes?.() ?? item.getTotalBytes?.() ?? 0)
        if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > MAX_BUNDLE_BYTES) return
        const task = TASK_ID.exec(filename)?.[0]
        log(`[chatgpt-bundle-received] completed file=${filename} bytes=${bytes}${task ? ` task=${task}` : ''}`)
      } catch { /* statistics must never fail the transport they describe */ }
    })
  } catch { /* registering optional telemetry never breaks delivery */ }
}
