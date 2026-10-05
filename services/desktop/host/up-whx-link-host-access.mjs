// Host services the Desktop may reach from inside the up-whx-link besides the
// Wharnex gateway: local applications under test in UI Lab. Reach stays
// opt-in and explicit — the operator lists the host ports in
// WHARNEX_UP_LINK_HOST_PORTS — so the namespace keeps exposing only what was
// named (adr/ADR-0072, adr/ADR-0089).

const MAX_EXTRA_PORTS = 16

/** Ports from WHARNEX_UP_LINK_HOST_PORTS ("80,443,5173"); invalid entries are ignored. */
export function hostAccessPorts(env = process.env) {
  const ports = new Set()
  for (const part of String(env.WHARNEX_UP_LINK_HOST_PORTS || '').split(',')) {
    const port = Number(part.trim())
    if (Number.isInteger(port) && port > 0 && port < 65536) ports.add(port)
    if (ports.size >= MAX_EXTRA_PORTS) break
  }
  return [...ports].sort((a, b) => a - b)
}
