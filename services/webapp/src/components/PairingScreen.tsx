import { useEffect, useRef, useState } from 'react'
import { pairingCodeFromScan } from '../lib/pairing'

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
      video.current.srcObject = stream.current
      await video.current.play()
      setScanning(true)
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
    } catch (cause) {
      setCameraError(cause instanceof Error ? cause.message : String(cause))
      setScanning(false)
    }
  }

  async function submitManual() {
    const code = pairingCodeFromScan(manual) || manual.trim()
    if (code) await onCode(code)
  }

  return <main className="grid min-h-dvh place-items-center bg-slate-950 px-4 py-8 text-slate-100 [color-scheme:dark]">
    <section className="w-full max-w-2xl overflow-hidden rounded-[2rem] border border-slate-800 bg-slate-900 shadow-2xl shadow-black/30">
      <div className="border-b border-slate-800 px-6 py-7 sm:px-8">
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-cyan-400">Wharnex Remote</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Emparelhe este dispositivo</h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-slate-400">Leia o QR apresentado pelo Wharnex Desktop. O código é temporário, de uso único e não transfere credenciais dos browsers de IA.</p>
      </div>
      <div className="grid gap-6 p-6 sm:p-8 md:grid-cols-[1.2fr_.8fr]">
        <div className="relative aspect-video overflow-hidden rounded-2xl border border-slate-800 bg-slate-950">
          <video ref={video} muted playsInline className={`h-full w-full object-cover ${scanning ? 'block' : 'hidden'}`} />
          {!scanning && <div className="grid h-full place-items-center p-6 text-center"><div><div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-cyan-400/10 text-2xl text-cyan-300">⌗</div><p className="font-medium">Scanner QR seguro</p><p className="mt-2 text-sm text-slate-500">A câmara é usada apenas localmente pelo navegador.</p></div></div>}
        </div>
        <div className="flex flex-col justify-center gap-3">
          <button type="button" disabled={checking} onClick={() => void startScanner()} className="rounded-xl bg-cyan-400 px-4 py-3 text-sm font-bold text-slate-950 hover:bg-cyan-300 disabled:opacity-50">{scanning ? 'Scanner ativo' : 'Abrir câmara'}</button>
          <div className="flex items-center gap-3 py-1 text-xs text-slate-600"><span className="h-px flex-1 bg-slate-800"/>ou<span className="h-px flex-1 bg-slate-800"/></div>
          <input value={manual} onChange={(event) => setManual(event.target.value)} placeholder="Cole o link ou código" className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm outline-none focus:border-cyan-400" />
          <button type="button" disabled={checking || !manual.trim()} onClick={() => void submitManual()} className="rounded-xl border border-slate-700 px-4 py-3 text-sm font-semibold hover:border-slate-500 disabled:opacity-40">Emparelhar</button>
          {(error || cameraError) && <p role="alert" className="rounded-xl border border-rose-900/70 bg-rose-950/40 p-3 text-xs leading-5 text-rose-200">{error || cameraError}</p>}
        </div>
      </div>
    </section>
  </main>
}
