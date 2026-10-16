import { Icon } from '../../presentation/chrome/Icon'

export function EditorWelcomePanel() {
  return <section className="grid min-h-0 flex-1 place-items-center bg-whx-bg px-6 py-10 text-center" aria-label="Editor sem ficheiro aberto">
    <div className="grid max-w-[480px] justify-items-center">
      <div className="mb-5 grid size-14 place-items-center rounded-xl border border-whx-border-soft bg-whx-surface text-whx-accent shadow-sm"><Icon name="code" size={24}/></div>
      <span className="mb-2 text-[calc(9px*var(--ui-font-scale))] font-semibold uppercase tracking-[0.12em] text-whx-faint">Editor</span>
      <h2 className="m-0 text-[calc(16px*var(--ui-font-scale))] font-semibold tracking-tight text-whx-text">Nenhum ficheiro aberto</h2>
      <p className="mb-5 mt-2 max-w-[390px] text-[calc(11px*var(--ui-font-scale))] leading-relaxed text-whx-soft">Escolha um ficheiro no Explorador do projeto para começar a trabalhar. Os ficheiros recentes e os rascunhos são mantidos nas tabs.</p>
      <div className="flex flex-wrap justify-center gap-2 text-[calc(9px*var(--ui-font-scale))] text-whx-faint">
        <span className="inline-flex items-center gap-2 rounded-md border border-whx-border-soft bg-whx-surface px-2.5 py-1.5">Pesquisar ficheiros <kbd className="rounded border border-whx-border bg-whx-bg px-1.5 py-0.5 font-mono text-whx-soft">Shift ×2</kbd></span>
        <span className="inline-flex items-center gap-2 rounded-md border border-whx-border-soft bg-whx-surface px-2.5 py-1.5">Pesquisar no projeto <kbd className="rounded border border-whx-border bg-whx-bg px-1.5 py-0.5 font-mono text-whx-soft">Ctrl+Shift+F</kbd></span>
      </div>
    </div>
  </section>
}
