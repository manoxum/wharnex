export type AutomationMode = 'manual' | 'auto' | 'auto_approve'
export type EffortLevel = 'low' | 'medium' | 'high' | 'extra_high' | 'max' | 'ultra' | 'loop'
export type ReasoningEffort = 'instant' | 'medium' | 'high'
/** Scraper: Desktop drives the embedded ChatGPT DOM directly, as it always
 *  has. Manual: Desktop never touches that DOM — the prompt is only shown
 *  for copy/paste and a response bundle is only imported by explicit human
 *  upload. Independent of AutomationMode; Auto + Manual is valid. */
export type ChatTransportMode = 'scraper' | 'manual'
export type TerminalTarget = 'sandbox' | 'host'
export type TerminalSessionDescriptor = { terminal_id: string; target: TerminalTarget; generation?: string }
export type TerminalFrame = { type: 'ready' | 'output' | 'exit' | 'error'; data?: string; code?: number; message?: string }
export type TerminalRunInput = { command: string; cwd: string; label?: string }
export type TerminalRunRequest = TerminalRunInput & { id: number; target?: TerminalTarget; openNew?: boolean }


export type DockerContainerCondition = 'running' | 'restarting' | 'paused' | 'created' | 'error' | 'stopped'
export type DockerContainer = {
  id: string
  name: string
  image: string
  state: string
  condition?: DockerContainerCondition | string
  status: string
  ports?: string
  networks?: string
  compose_project?: string
  compose_service?: string
  exit_code?: number
  error?: string
  protected?: boolean
}

export type DockerComposeService = { name: string; container_count: number; running_count: number; error_count: number }
export type DockerComposeProject = {
  name: string
  container_count: number
  running_count: number
  error_count: number
  stopped_count: number
  protected?: boolean
  redeploy_available?: boolean
  redeploy_reason?: string
  config_files?: string[]
  services?: DockerComposeService[]
}
export type DockerImage = { id: string; repository: string; tag: string; size: string; created_since?: string; in_use?: boolean; container_count?: number }
export type DockerVolume = { name: string; driver: string; mountpoint?: string; scope?: string; in_use?: boolean; container_count?: number }
export type DockerNetwork = { id: string; name: string; driver: string; scope?: string; internal?: boolean; in_use?: boolean; container_count?: number }
export type DockerOverview = {
  compose_projects: DockerComposeProject[]
  containers: DockerContainer[]
  images: DockerImage[]
  volumes: DockerVolume[]
  networks: DockerNetwork[]
  refreshed_at: string
}
export type DockerLogs = { container_id: string; tail: number; content: string }
export type DockerContainerAction = 'start' | 'stop' | 'restart'
export type DockerResourceKind = 'volume' | 'network'
