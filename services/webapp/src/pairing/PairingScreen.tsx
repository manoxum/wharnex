import { useEffect, useRef, useState } from 'react'
import { pairingCodeFromScan } from './pairing'

type Detector = { detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue?: string }>> }
type DetectorConstructor = new (options?: { formats?: string[] }) => Detector

export function PairingScreen({ checking, error, onCode }: { checking: boolean; error: string; onCode: (code: string) => Promise<void> }) {
  const video = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const [scanning, setScanning] = useState(false)
  const [manual, setManual] = useState('')
  const [cameraError, setCameraError] = useState('')

  useEffect(() => () => stream.current?.getTracks().forEach((track) => track.stop()), [])

  async function startScanner() {
    setCameraError('')
    const BarcodeDetector = (window as unknown as { BarcodeDetector?: DetectorConstructor }).BarcodeDetector
    if (!BarcodeDetector) { setCameraError('Este navegador não suporta leitura QR pela câmara. Cole o código abaixo.'); return }
    try {
      stream.current?.getTracks().forEach((track) => track.stop())
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      if (!video.current) return
      video.current.srcObject = stream.current; await video.current.play(); setScanning(true)
      const detector = new BarcodeDetector({ formats: ['qr_code'] })
      const scan = async () => {
        if (!video.current || !stream.current) return
        try {
          const found = await detector.detect(video.current)
          const code = pairingCodeFromScan(found[0]?.rawValue || '')
          if (code) { stream.current.getTracks().forEach((track) => track.stop()); setScanning(false); await onCode(code); return }
        } catch { /* next frame */ }
        window.setTimeout(() => void scan(), 350)
      }
      void scan()
    } catch (cause) { setCameraError(cause instanceof Error ? cause.message : String(cause)); setScanning(false) }
  }

  async function submitManual() { const code = pairingCodeFromScan(manual) || manual.trim(); if (code) await onCode(code) }

  return <main className="relative grid min-h-dvh place-items-center overflow-hidden bg-canvas px-4 py-8 text-ink">
    <div className="pointer-events-none absolute -left-24 -top-24 size-80 rounded-full bg-accent/10 blur-3xl"/><div className="pointer-events-none absolute -bottom-32 -right-16 size-96 rounded-full bg-accent/5 blur-3xl"/>
    <section className="relative w-full max-w-3xl overflow-hidden rounded-[28px] border border-line bg-surface shadow-[0_28px_90px_var(--theme-shadow)]">
      <div className="grid gap-0 md:grid-cols-[1.05fr_.95fr]">
        <div className="border-b border-line p-6 sm:p-8 md:border-b-0 md:border-r">
          <div className="flex items-center gap-3"><div className="grid size-10 place-items-center rounded-xl bg-accent text-sm font-black text-accent-ink">W</div><div><p className="text-[10px] font-extrabold uppercase tracking-[0.22em] text-accent">Wharnex Remote</p><p className="text-xs text-faint">Ligação segura ao Desktop</p></div></div>
          <h1 className="mt-8 max-w-sm text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">Continue o seu workspace em qualquer ecrã.</h1>
          <p className="mt-4 max-w-md text-sm leading-6 text-soft">Leia o QR apresentado pelo Wharnex Desktop. O código é temporário e de uso único; as credenciais dos browsers de IA continuam no Desktop.</p>
          <div className="mt-7 relative aspect-video overflow-hidden rounded-2xl border border-line bg-muted">
            <video ref={video} muted playsInline className={`h-full w-full object-cover ${scanning ? 'block' : 'hidden'}`}/>
            {!scanning && <div className="grid h-full place-items-center p-6 text-center"><div><div className="mx-auto mb-3 grid size-12 place-items-center rounded-2xl border border-line-soft bg-elevated text-xl text-accent">⌗</div><p className="text-sm font-semibold">Scanner QR local</p><p className="mt-1 text-xs text-faint">A imagem da câmara não é enviada ao servidor.</p></div></div>}
          </div>
        </div>
        <div className="flex flex-col justify-center p-6 sm:p-8">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-faint">Emparelhar dispositivo</p><p className="mt-2 text-sm leading-6 text-soft">Use a câmara ou cole o link/código que aparece no Desktop.</p>
          <button type="button" disabled={checking} onClick={() => void startScanner()} className="mt-6 rounded-xl bg-accent px-4 py-3 text-sm font-bold text-accent-ink shadow-sm transition hover:brightness-105 disabled:opacity-50">{scanning ? 'Scanner ativo' : 'Abrir câmara'}</button>
          <div className="flex items-center gap-3 py-4 text-[10px] font-bold uppercase tracking-[0.15em] text-faint"><span className="h-px flex-1 bg-line-soft"/>ou<span className="h-px flex-1 bg-line-soft"/></div>
          <input value={manual} onChange={(event) => setManual(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void submitManual() }} placeholder="Cole o link ou código" className="rounded-xl border border-line bg-elevated px-3 py-3 text-sm text-ink outline-none transition placeholder:text-faint focus:border-accent"/>
          <button type="button" disabled={checking || !manual.trim()} onClick={() => void submitManual()} className="mt-2 rounded-xl border border-line bg-surface px-4 py-3 text-sm font-semibold text-soft transition hover:bg-hover hover:text-ink disabled:opacity-40">{checking ? 'A verificar…' : 'Emparelhar'}</button>
          {(error || cameraError) && <p role="alert" className="mt-3 rounded-xl border border-danger/25 bg-danger/10 p-3 text-xs leading-5 text-danger">{error || cameraError}</p>}
          <p className="mt-6 text-[10px] leading-5 text-faint">O emparelhamento associa apenas este navegador ao backend Wharnex autorizado.</p>
        </div>
      </div>
    </section>
  </main>
}
