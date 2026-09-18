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

// Mirrors the general shape of a WorkspaceSideRail drawer: a heading row
// plus a handful of list-like rows, so the placeholder doesn't jump when the
// real panel (Git, Postgres, Runtime, Tasks, Knowledge...) mounts in.
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
