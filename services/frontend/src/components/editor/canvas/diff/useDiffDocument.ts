import { useEffect, useState } from 'react'
import { api } from '../../../../lib/transport/http/api'
import { buildDiffDocument, type DiffDocument } from '../../../../lib/editor/runtime/unifiedDiff'
import type { ChatChangeFile } from '../../../../types'

type LoadedDocument = { sessionId: string; path: string; diff: string; fragmentOnly: boolean; value: DiffDocument }

export function useDiffDocument(sessionId: string, file: ChatChangeFile, fragmentOnly: boolean) {
  const { path, diff } = file
  const [loaded, setLoaded] = useState<LoadedDocument>()
  useEffect(() => {
    let alive = true
    const publish = (content?: string) => {
      if (alive) setLoaded({ sessionId, path, diff, fragmentOnly, value: buildDiffDocument(diff, content) })
    }
    if (fragmentOnly) publish()
    else void api.readFile(sessionId, path).then((current) => publish(current.content)).catch(() => publish())
    return () => { alive = false }
  }, [sessionId, path, diff, fragmentOnly])
  // Never initialize a new file's Monaco models with the previous file's text.
  return loaded?.sessionId === sessionId && loaded.path === path && loaded.diff === diff && loaded.fragmentOnly === fragmentOnly ? loaded.value : undefined
}
