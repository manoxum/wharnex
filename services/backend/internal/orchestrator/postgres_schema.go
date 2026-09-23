package orchestrator

const postgresSchema = `
CREATE TABLE IF NOT EXISTS harness_orchestrator_plans (
    id text PRIMARY KEY,
    project_path text NOT NULL,
    status text NOT NULL,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    payload jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS harness_orchestrator_plans_project_idx
    ON harness_orchestrator_plans (project_path, created_at, id);
CREATE TABLE IF NOT EXISTS harness_tasks (
    task_id text PRIMARY KEY,
    type text NOT NULL,
    source text NOT NULL DEFAULT 'chat',
    project_id text NOT NULL DEFAULT '',
    chat_id text NOT NULL DEFAULT '',
    session_id text NOT NULL DEFAULT '',
    request_id text NOT NULL DEFAULT '',
    root_request_id text NOT NULL DEFAULT '',
    conversation_id text NOT NULL DEFAULT '',
    parent_task_id text NOT NULL DEFAULT '',
    plan_id text NOT NULL DEFAULT '',
    title text NOT NULL DEFAULT '',
    description text NOT NULL DEFAULT '',
    condition text NOT NULL DEFAULT '',
    priority integer NOT NULL DEFAULT 0,
    status text NOT NULL,
    not_before timestamptz NOT NULL DEFAULT now(),
    attempt integer NOT NULL DEFAULT 0,
    max_attempts integer NOT NULL DEFAULT 6,
    dedupe_key text NOT NULL DEFAULT '',
    assigned_worker text NOT NULL DEFAULT '',
    keep_flowing boolean NOT NULL DEFAULT false,
    lease_owner text NOT NULL DEFAULT '',
    lease_expires_at timestamptz,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    last_error text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS harness_tasks_project_idx
    ON harness_tasks (project_id, source, updated_at DESC, task_id);
CREATE TABLE IF NOT EXISTS harness_task_dependencies (
    task_id text NOT NULL REFERENCES harness_tasks(task_id) ON DELETE CASCADE,
    depends_on_task_id text NOT NULL REFERENCES harness_tasks(task_id) ON DELETE RESTRICT,
    PRIMARY KEY (task_id, depends_on_task_id)
);
CREATE TABLE IF NOT EXISTS harness_task_runs (
    id text PRIMARY KEY,
    task_id text NOT NULL REFERENCES harness_tasks(task_id) ON DELETE CASCADE,
    project_path text NOT NULL,
    attempt integer NOT NULL,
    status text NOT NULL,
    started_at timestamptz NOT NULL,
    completed_at timestamptz,
    payload jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS harness_task_runs_task_idx
    ON harness_task_runs (task_id, attempt, started_at);
DO $$
BEGIN
    IF to_regclass('public.harness_orchestrator_tasks') IS NOT NULL THEN
        INSERT INTO harness_tasks (
            task_id,type,source,project_id,plan_id,title,description,condition,priority,
            status,not_before,payload,created_at,updated_at
        )
        SELECT id,'ORCHESTRATOR_TASK','orchestrator',project_path,plan_id,
               COALESCE(payload->>'title',''),COALESCE(payload->>'description',''),
               COALESCE(payload->>'condition',''),
               CASE COALESCE(payload->>'priority','normal')
                   WHEN 'urgent' THEN 0 WHEN 'high' THEN 10 WHEN 'low' THEN 30 ELSE 20 END,
               status,created_at,payload,created_at,updated_at
        FROM harness_orchestrator_tasks
        ON CONFLICT (task_id) DO UPDATE SET
            source=EXCLUDED.source,project_id=EXCLUDED.project_id,plan_id=EXCLUDED.plan_id,
            title=EXCLUDED.title,description=EXCLUDED.description,condition=EXCLUDED.condition,
            priority=EXCLUDED.priority,status=EXCLUDED.status,payload=EXCLUDED.payload,
            updated_at=EXCLUDED.updated_at;

        IF to_regclass('public.harness_orchestrator_task_dependencies') IS NOT NULL THEN
            INSERT INTO harness_task_dependencies (task_id,depends_on_task_id)
            SELECT task_id,depends_on_task_id FROM harness_orchestrator_task_dependencies
            ON CONFLICT DO NOTHING;
            DROP TABLE harness_orchestrator_task_dependencies;
        END IF;
        IF to_regclass('public.harness_orchestrator_task_runs') IS NOT NULL THEN
            INSERT INTO harness_task_runs (id,task_id,project_path,attempt,status,started_at,completed_at,payload)
            SELECT id,task_id,project_path,attempt,status,started_at,completed_at,payload
            FROM harness_orchestrator_task_runs
            ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status,
                completed_at=EXCLUDED.completed_at,payload=EXCLUDED.payload;
            DROP TABLE harness_orchestrator_task_runs;
        END IF;
        DROP TABLE harness_orchestrator_tasks;
    END IF;
END $$;`
