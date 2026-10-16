import { Icon } from '../../../presentation/chrome/Icon'

export function GitContextIdentity({ branch, version, stateLabel, working, pending, outgoing }: { branch: string; version?: string; stateLabel: string; working: number; pending: number; outgoing: number }) {
  return <>
    <span className="inline-flex min-w-0 flex-1 items-center gap-1.5">
      <span className="project-git-icon shrink-0"><Icon name="git" size={13}/>{stateLabel && <span className="project-git-state-dots" aria-label={stateLabel}>{working ? <i className="working"/> : null}{pending ? <i className="pending"/> : null}{outgoing ? <i className="outgoing"/> : null}</span>}</span>
      <strong className="min-w-0 truncate text-whx-label font-medium" title={branch}>{branch}</strong>
    </span>
    <span className="project-git-version max-w-24 shrink-0 truncate rounded border border-whx-border-soft bg-whx-surface px-1.5 py-0.5 font-mono text-whx-caption font-medium text-whx-soft" title={version}>{version || 'v…'}</span>
    <span className="shrink-0"><Icon name="chevron" size={11}/></span>
  </>
}
