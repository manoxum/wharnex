// Generic loading placeholders shared by every deferred/async surface in the
// app (lazy-loaded drawers, the startup workspace restore) - not specific to
// chat, which already had its own equivalent for progressive transcript
// hydration (see ProgressiveTranscriptEntry's chat-entry-skeleton).

export function SkeletonLine({ width = '100%' }: { width?: string | number }) {
  return <i className="skeleton-line" style={{ width }}/>
}

export function SkeletonBlock({ width = '100%', height = 64 }: { width?: string | number; height?: string | number }) {
  return <div className="skeleton-block" style={{ width, height }}/>
}

// Shared body placeholder for async data inside an already-mounted panel/tab.
// First loads skeletonize the missing geometry; background refreshes should keep
// useful stale content visible instead of replacing it with this placeholder.
export function ContentSkeleton({ label = 'A carregar conteúdo', rows = 4, compact = false }: { label?: string; rows?: number; compact?: boolean }) {
  const safeRows = Math.max(1, Math.min(rows, 8))
  return <div className={`async-content-skeleton${compact ? ' compact' : ''}`} aria-busy="true" aria-label={label}>
    <SkeletonLine width={compact ? '34%' : '42%'}/>
    <div className="async-content-skeleton-rows">
      {Array.from({ length: safeRows }, (_, index) => <div className="async-content-skeleton-row" key={index}>
        <SkeletonLine width={`${88 - ((index * 9) % 28)}%`}/>
        {!compact && <SkeletonLine width={`${38 + ((index * 7) % 24)}%`}/>}
      </div>)}
    </div>
  </div>
}

export function EditorSurfaceSkeleton() {
  return <div className="editor-surface-skeleton" aria-busy="true" aria-label="A carregar editor">
    <div className="editor-surface-skeleton-tabs"><SkeletonLine width="18%"/><SkeletonLine width="14%"/><SkeletonLine width="12%"/></div>
    <div className="editor-surface-skeleton-body"><SkeletonBlock width={36}/><div>{Array.from({ length: 10 }, (_, index) => <SkeletonLine key={index} width={`${78 - ((index * 11) % 34)}%`}/>)}</div></div>
  </div>
}

// Mirrors the general shape of a WorkspaceSideRail drawer: a heading row
// plus list-like rows, so lazy-loaded panels do not jump when they mount.
export function PanelSkeleton() {
  return <div className="panel-skeleton" aria-busy="true" aria-label="A carregar painel">
    <header><SkeletonLine width="46%"/><SkeletonLine width={22}/></header>
    <div className="panel-skeleton-rows">
      {[92, 78, 86, 64, 80].map((width, index) => <div className="panel-skeleton-row" key={index}>
        <SkeletonLine width={`${width}%`}/>
        <SkeletonLine width="34%"/>
      </div>)}
    </div>
  </div>
}

// Previews the shape of the workbench itself (rail + side drawer + chat +
// inspector) while the very first session/workspace restore is still in
// flight, instead of a bare loading sentence on an otherwise empty screen.
export function WorkspaceSkeleton() {
  return <div className="workspace-skeleton" aria-busy="true" aria-label="A restaurar o workspace">
    <div className="workspace-skeleton-rail">{Array.from({ length: 5 }, (_, index) => <SkeletonBlock key={index} width={22} height={22}/>)}</div>
    <div className="workspace-skeleton-chat">
      <SkeletonBlock height={34} width="40%"/>
      <SkeletonBlock height={72}/>
      <SkeletonBlock height={72} width="88%"/>
      <SkeletonBlock height={72} width="72%"/>
    </div>
    <div className="workspace-skeleton-inspector">
      <SkeletonBlock height={22} width="60%"/>
      <SkeletonBlock height={140}/>
    </div>
  </div>
}
