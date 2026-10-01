import { lazy, Suspense, useEffect, useState, type ComponentProps } from 'react'
import { EditorSurfaceSkeleton } from '../../presentation/chrome/Skeleton'

const LazyEditorWorkspace = lazy(async () => {
  const [editorModule, monacoModule] = await Promise.all([
    import('./EditorWorkspace'),
    import('../../../lib/editor/runtime/monaco'),
  ])
  await monacoModule.loadMonaco()
  return { default: editorModule.EditorWorkspace }
})

type Props = ComponentProps<typeof LazyEditorWorkspace>

export function DeferredEditorWorkspace(props: Props) {
  const requested = Boolean(props.surfaceMode) || props.active !== false
  const [activated, setActivated] = useState(requested)

  useEffect(() => {
    if (requested) setActivated(true)
  }, [requested])

  if (!activated && !requested) return null
  return <Suspense fallback={<EditorSurfaceSkeleton/>}><LazyEditorWorkspace {...props}/></Suspense>
}
