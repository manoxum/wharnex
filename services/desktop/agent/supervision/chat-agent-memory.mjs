function processID(value) {
  const pid = Number(value || 0)
  return Number.isInteger(pid) && pid > 0 ? pid : 0
}

function workingSetBytes(metric) {
  const kilobytes = Number(metric?.memory?.workingSetSize)
  return Number.isFinite(kilobytes) && kilobytes >= 0 ? Math.round(kilobytes * 1024) : 0
}

export function chatAgentMemorySnapshot(agents = [], metrics = []) {
  const metricByPID = new Map()
  for (const metric of metrics) {
    const pid = processID(metric?.pid)
    if (!pid || metricByPID.has(pid)) continue
    metricByPID.set(pid, workingSetBytes(metric))
  }

  const agentsByPID = new Map()
  const byAgent = Object.fromEntries(agents.map((agent) => [String(agent?.id || ''), {
    available: false,
    rss_bytes: 0,
    os_process_id: processID(agent?.browser?.os_process_id),
    shared_process: false,
  }]))

  for (const agent of agents) {
    const pid = processID(agent?.browser?.os_process_id)
    if (!pid || !metricByPID.has(pid)) continue
    const members = agentsByPID.get(pid) || []
    members.push(agent)
    agentsByPID.set(pid, members)
  }

  // Chromium may place more than one ChatGPT WebContents in one renderer.
  // Split that renderer RSS across its owners so per-agent numbers remain
  // useful while the worker/supervisor/global totals never double-count RAM.
  for (const [pid, members] of agentsByPID) {
    const processBytes = metricByPID.get(pid) || 0
    const share = Math.floor(processBytes / members.length)
    let remainder = processBytes - share * members.length
    for (const agent of members) {
      const id = String(agent?.id || '')
      const extraByte = remainder > 0 ? 1 : 0
      remainder = Math.max(0, remainder - extraByte)
      byAgent[id] = {
        available: true,
        rss_bytes: share + extraByte,
        os_process_id: pid,
        shared_process: members.length > 1,
      }
    }
  }

  let workers = 0
  let supervisors = 0
  for (const agent of agents) {
    const bytes = byAgent[String(agent?.id || '')]?.rss_bytes || 0
    if (agent?.role === 'worker') workers += bytes
    else if (agent?.role === 'supervisor') supervisors += bytes
  }
  const agentsTotal = workers + supervisors
  const appTotal = [...metricByPID.values()].reduce((sum, bytes) => sum + bytes, 0)

  return {
    by_agent: byAgent,
    totals: {
      available: metricByPID.size > 0,
      total_workers_bytes: workers,
      total_supervisors_bytes: supervisors,
      total_agents_bytes: agentsTotal,
      desktop_bytes: Math.max(0, appTotal - agentsTotal),
      total_bytes: appTotal,
    },
  }
}
