type SignalCoreSize = 'compact' | 'regular' | 'large' | 'watermark'

export function SignalCore({ size = 'regular', decorative = false }: { size?: SignalCoreSize; decorative?: boolean }) {
  return <span
    className={`signal-core signal-core-${size}`}
    role={decorative ? undefined : 'img'}
    aria-label={decorative ? undefined : 'Signal Core'}
    aria-hidden={decorative ? true : undefined}
    title={decorative ? undefined : 'Signal Core'}
  >
    <svg viewBox="0 0 32 32" focusable="false" aria-hidden="true">
      <circle className="signal-core-orbit signal-core-orbit-outer" cx="16" cy="16" r="11.75" />
      <circle className="signal-core-orbit signal-core-orbit-inner" cx="16" cy="16" r="7.25" />
      <circle className="signal-core-center" cx="16" cy="16" r="3.35" />
    </svg>
  </span>
}
