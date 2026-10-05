import { createDesktopContext, composeFoundation } from './foundation.mjs'
import { composeOwnership, composeWindowAssembly } from './ownership.mjs'
import { composeChatWorkflow } from './chat-workflow.mjs'
import { composeBrowserViews } from './browser-views.mjs'
import { composeAgentScheduling, composeSupervisorSurfaces } from './agent-scheduling.mjs'
import { composeTransport } from './transport.mjs'
import { composeWorkers } from './workers.mjs'
import { composeEntrypoint } from './entrypoint.mjs'

// Each stage reads what earlier stages provided from one composition context
// and provides its own outputs to it; this order is the dependency order.
export function composeDesktop(entryURL) {
  const desktop = createDesktopContext(entryURL)
  composeFoundation(desktop)
  composeOwnership(desktop)
  composeWindowAssembly(desktop)
  composeChatWorkflow(desktop)
  composeBrowserViews(desktop)
  composeAgentScheduling(desktop)
  composeSupervisorSurfaces(desktop)
  composeTransport(desktop)
  composeWorkers(desktop)
  composeEntrypoint(desktop)
  return desktop
}
