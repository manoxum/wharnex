import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import type { Session, WorkspaceMode } from '../../types'
import { api } from '../../lib/transport/http/api'
import { errorMessage as messageOf } from '../../lib/workspace/dialogs/errorMessage'

type Params = {
  embeddedProject: string
  shellActive: boolean
  boundProjects: string[]
  session?: Session
  mode: WorkspaceMode
  relatedProjectsSyncRef: MutableRefObject<string>
  setShellActive: Dispatch<SetStateAction<boolean>>
  setBoundProjects: Dispatch<SetStateAction<string[]>>
  setMode: Dispatch<SetStateAction<WorkspaceMode>>
  setProjectSettingsOpen: Dispatch<SetStateAction<boolean>>
  setAttentionPreviewOpen: Dispatch<SetStateAction<boolean>>
  setSession: Dispatch<SetStateAction<Session | undefined>>
  setError: Dispatch<SetStateAction<string | undefined>>
}

export function useEmbeddedProjectBridge({ embeddedProject, shellActive, boundProjects, session, mode, relatedProjectsSyncRef, setShellActive, setBoundProjects, setMode, setProjectSettingsOpen, setAttentionPreviewOpen, setSession, setError }: Params) {
  useEffect(() => {
    if (!embeddedProject) return
    const handler = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      if (event.data?.type === 'wharness:project-active') {
        setShellActive(Boolean(event.data.active))
        if (Array.isArray(event.data.projects)) setBoundProjects(event.data.projects.map(String).filter(Boolean))
      }
      if (event.data?.type === 'wharness:set-workspace-mode' && (event.data.mode === 'editor' || event.data.mode === 'agent' || event.data.mode === 'orchestrator')) setMode(event.data.mode)
      if (event.data?.type === 'wharness:open-project-settings') setProjectSettingsOpen(true)
      if (event.data?.type === 'wharness:open-attention') setAttentionPreviewOpen((open) => !open)
      if (event.data?.type === 'wharness:close-header-overlays') setAttentionPreviewOpen(false)
    }
    window.addEventListener('message', handler)
    window.parent.postMessage({ type: 'wharness:project-ready', projectPath: embeddedProject }, window.location.origin)
    return () => window.removeEventListener('message', handler)
  }, [embeddedProject])

  useEffect(() => {
    if (!embeddedProject || !shellActive || !session) return
    const related = [...new Set(boundProjects.filter((projectPath) => projectPath && projectPath !== session.project_path))]
    const key = `${session.id}:${related.join('\n')}`
    if (relatedProjectsSyncRef.current === key) return
    relatedProjectsSyncRef.current = key
    void api.setRelatedProjects(session.id, related).then((updated) => {
      setSession((current) => current?.id === updated.id ? updated : current)
    }).catch((reason) => {
      relatedProjectsSyncRef.current = ''
      setError(messageOf(reason))
    })
  }, [boundProjects, embeddedProject, session?.id, session?.project_path, shellActive])

  useEffect(() => {
    if (!embeddedProject) return
    window.parent.postMessage({ type: 'wharness:workspace-mode', projectPath: embeddedProject, mode }, window.location.origin)
  }, [embeddedProject, mode])

  useEffect(() => {
    if (!embeddedProject) return
    window.parent.postMessage({ type: 'wharness:project-session', projectPath: embeddedProject, sessionId: session?.id || '' }, window.location.origin)
  }, [embeddedProject, session?.id])

  useEffect(() => {
    if (!embeddedProject) return
    window.parent.postMessage({
      type: 'wharness:project-runtime',
      projectPath: embeddedProject,
      selfEvolution: Boolean(session?.self_evolution),
      instanceId: session?.wharnex_instance_id || '',
    }, window.location.origin)
  }, [embeddedProject, session?.self_evolution, session?.wharnex_instance_id])

  useEffect(() => {
    if (!embeddedProject || !session?.id) return
    const handler = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.data?.type !== 'wharness:refresh-session') return
      void api.getSession(session.id).then(setSession).catch((reason) => setError(messageOf(reason)))
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [embeddedProject, session?.id])

}
