import type { ContextMode } from '../../../types'

export function ComposerContextModeControl({ mode, disabled, onChange }: {
  mode: ContextMode
  disabled: boolean
  onChange?: (mode: ContextMode) => void
}) {
  return <label className="inline-flex h-[29px] items-center gap-1.5 rounded-full border border-[#d7ddd2] bg-[#f7f9f4] px-2 text-[#4f594b] focus-within:border-[#8fa878]" title="Parcial envia mapas primeiro e acrescenta ficheiros pedidos pelo GPT; Full envia todo o contexto elegível">
    <span className="font-mono text-[8px] font-bold uppercase tracking-wide text-[#7e8879]">Contexto</span>
    <select className="h-[23px] cursor-pointer rounded-full border-0 bg-[#e9eee5] px-2 text-[9px] font-bold text-[#414b3d] disabled:cursor-default disabled:opacity-50" aria-label="Modalidade de contexto" value={mode} disabled={disabled || !onChange} onChange={(event) => onChange?.(event.target.value as ContextMode)}>
      <option value="partial">Parcial</option>
      <option value="full">Full</option>
    </select>
  </label>
}
