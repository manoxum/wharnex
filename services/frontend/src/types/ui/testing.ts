export type UITestProfile = { id: string; label: string; role: string; configured: boolean }
export type UITestEnvironment = { id: string; name: string; description?: string; url?: string; profiles: UITestProfile[] }
export type UITestCase = { id: string; title: string; description?: string; goal: string; environment_id: string; profile_id?: string; priority?: string; status: string; last_run_id?: string }
export type UITestStep = { index: number; action: string; caption?: string; outcome?: string; screenshot?: string }
export type UITestRun = { id: string; task_id?: string; test_id: string; status: string; error?: string; steps?: UITestStep[]; started_at: string; completed_at?: string }
export type UIGuide = { id: string; test_id: string; run_id: string; title: string; markdown: string; pdf_ready: boolean; screenshots?: UITestStep[]; updated_at: string }
export type UITestingDocument = {
  project_id: string
  context_sha256?: string
  sync_status: string
  sync_task_id?: string
  sync_error?: string
  auto_run_changes: boolean
  environments: UITestEnvironment[]
  tests: UITestCase[]
  runs: UITestRun[]
  guides: UIGuide[]
  updated_at?: string
}
