export type UITestProfile = { id: string; label: string; role: string; configured: boolean }
export type UITestEnvironment = { id: string; name: string; description?: string; url?: string; notes?: string; profiles: UITestProfile[] }
export type UITestAccess = 'public' | 'authenticated'
export type UITestStrategyStep = { action: string; expected?: string }
export type UITestCase = {
  id: string
  title: string
  description?: string
  goal: string
  environment_id: string
  profile_id?: string
  priority?: string
  access?: UITestAccess
  category?: string
  preconditions?: string[]
  steps?: UITestStrategyStep[]
  expected_result?: string
  test_data?: string[]
  depends_on?: string[]
  tags?: string[]
  source?: 'discovered' | 'user'
  brief?: string
  status: string
  last_run_id?: string
}
export type UITestStep = { index: number; action: string; caption?: string; screen_caption?: string; outcome?: string; screenshot?: string; selector?: string }
export type UITestRun = { id: string; task_id?: string; test_id: string; status: string; error?: string; role?: 'target' | 'dependency'; parent_run_id?: string; restored_from?: string; steps?: UITestStep[]; started_at: string; completed_at?: string }
export type UIGuide = { id: string; test_id: string; run_id: string; title: string; markdown: string; pdf_ready: boolean; html_ready?: boolean; screenshots?: UITestStep[]; updated_at: string }
export type UITestDesignRequest = { task_id: string; brief: string; environment_id?: string; status: 'designing' | 'done' | 'failed'; error?: string; test_ids?: string[]; created_at: string; updated_at: string }
export type UITestSession = { id: string; environment_id: string; test_id: string; profile_id?: string; covers: string[]; valid: boolean; captured_at: string; expires_at: string }
export type UITestingDocument = {
  project_id: string
  context_sha256?: string
  sync_status: string
  sync_task_id?: string
  sync_error?: string
  sync_summary?: string
  auto_run_changes: boolean
  environments: UITestEnvironment[]
  tests: UITestCase[]
  runs: UITestRun[]
  guides: UIGuide[]
  designs?: UITestDesignRequest[]
  sessions?: UITestSession[]
  updated_at?: string
}
