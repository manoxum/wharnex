-- Run in a transaction on PostgreSQL; the temporary fixture shadows real state.
BEGIN;
CREATE TEMP TABLE harness_tasks (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 sid text NOT NULL UNIQUE,
 uid uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
 source text, type text, status text, not_before timestamptz,
 lease_owner text DEFAULT '', lease_expires_at timestamptz,
 last_error text, updated_at timestamptz DEFAULT now(), attempt integer DEFAULT 2
);
INSERT INTO harness_tasks(sid,source,type,status,not_before,last_error) VALUES
 ('legacy','ui-testing','UI_TEST_RUN','WAITING','2100-01-01','Suspended by operator: all UI tests held until UI test suspension ships (2026-10-06). original error'),
 ('pending','ui-testing','UI_TEST_DISCOVER','PENDING','2100-01-01',''),
 ('cooldown','ui-testing','UI_TEST_RUN','WAITING',now()+interval '20 minutes','upload cooldown'),
 ('cancelled','ui-testing','UI_TEST_RUN','CANCELLED','2100-01-01','Suspended by operator: all UI tests held until UI test suspension ships (2026-10-06). original error'),
 ('other','chat','BOT_WRITE','WAITING','2100-01-01','Suspended by operator: all UI tests held until UI test suspension ships (2026-10-06). original error'),
 ('unrelated','ui-testing','UI_TEST_RUN','WAITING','2100-01-01','some other hold');
CREATE FUNCTION pg_temp.wharnex_temp_hold_ui_tests() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
 IF NEW.type IN ('UI_TEST_RUN','UI_TEST_DISCOVER') AND NEW.status IN ('PENDING','WAITING') THEN
  NEW.not_before := '2100-01-01T00:00:00Z';
 END IF;
 RETURN NEW;
END $fn$;
CREATE TRIGGER wharnex_temp_hold_ui_tests BEFORE INSERT OR UPDATE ON harness_tasks
 FOR EACH ROW EXECUTE FUNCTION pg_temp.wharnex_temp_hold_ui_tests();
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM harness_tasks WHERE sid='legacy' AND not_before<=now() AND status='WAITING' AND attempt=2 AND last_error='original error') THEN
  RAISE EXCEPTION 'legacy UI task still blocked or recovery lost state';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM harness_tasks WHERE sid='pending' AND not_before<=now() AND status='PENDING' AND attempt=2) THEN
  RAISE EXCEPTION 'new task still blocked by removed trigger';
 END IF;
 IF (SELECT count(*) FROM harness_tasks WHERE sid NOT IN ('legacy','pending') AND not_before>now()) <> 4 THEN
  RAISE EXCEPTION 'unrelated work was resumed';
 END IF;
END $$;
ROLLBACK;
