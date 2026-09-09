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
CREATE TABLE IF NOT EXISTS harness_orchestrator_tasks (
    id text PRIMARY KEY,
    project_path text NOT NULL,
    plan_id text NOT NULL DEFAULT '',
    status text NOT NULL,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    payload jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS harness_orchestrator_tasks_project_idx
    ON harness_orchestrator_tasks (project_path, created_at, id);
CREATE TABLE IF NOT EXISTS harness_orchestrator_task_dependencies (
    task_id text NOT NULL REFERENCES harness_orchestrator_tasks(id) ON DELETE CASCADE,
    depends_on_task_id text NOT NULL REFERENCES harness_orchestrator_tasks(id) ON DELETE RESTRICT,
    PRIMARY KEY (task_id, depends_on_task_id)
);
CREATE TABLE IF NOT EXISTS harness_orchestrator_task_runs (
    id text PRIMARY KEY,
    task_id text NOT NULL REFERENCES harness_orchestrator_tasks(id) ON DELETE CASCADE,
    project_path text NOT NULL,
    attempt integer NOT NULL,
    status text NOT NULL,
    started_at timestamptz NOT NULL,
    completed_at timestamptz,
    payload jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS harness_orchestrator_task_runs_task_idx
    ON harness_orchestrator_task_runs (task_id, attempt, started_at);`
