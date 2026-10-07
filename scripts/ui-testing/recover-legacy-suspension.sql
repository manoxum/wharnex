-- Remove only the named pre-ADR-0093 trigger on this queue. Refuse an
-- unexpected definition rather than remove an unrelated database policy.
DO $$
DECLARE suspension record;
BEGIN
 SELECT t.oid, t.tgname, p.proname, n.nspname, pg_get_functiondef(p.oid) AS definition
 INTO suspension FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
 JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE t.tgrelid='harness_tasks'::regclass AND t.tgname='wharnex_temp_hold_ui_tests';
 IF FOUND THEN
  IF position('2100-01-01T00:00:00Z' in suspension.definition)=0
   OR position('UI_TEST_RUN' in suspension.definition)=0
   OR position('UI_TEST_DISCOVER' in suspension.definition)=0
   OR position('NEW.not_before' in suspension.definition)=0 THEN
   RAISE EXCEPTION 'Unexpected temporary UI suspension trigger definition';
  END IF;
  EXECUTE format('DROP TRIGGER %I ON %s', suspension.tgname, 'harness_tasks'::regclass);
  EXECUTE format('DROP FUNCTION %I.%I()', suspension.nspname, suspension.proname);
 END IF;
END $$;

-- One-time compatibility recovery for the pre-ADR-0093 operator suspension.
-- Holds still govern claims. Preserve attempts, payloads, identity and outcomes;
-- ordinary cooldowns, terminal tasks and unrelated far-future work are excluded.
UPDATE harness_tasks
SET not_before = now(),
    last_error = CASE WHEN last_error = '' THEN '' ELSE substr(last_error, length('Suspended by operator: all UI tests held until UI test suspension ships (2026-10-06). ') + 1) END,
    updated_at = now()
WHERE source = 'ui-testing'
  AND type IN ('UI_TEST_RUN', 'UI_TEST_DISCOVER')
  AND status IN ('PENDING', 'WAITING')
  AND not_before = '2100-01-01T00:00:00Z'::timestamptz
  AND coalesce(lease_owner, '') = ''
  AND lease_expires_at IS NULL
  AND (starts_with(last_error, 'Suspended by operator: all UI tests held until UI test suspension ships (2026-10-06). ')
       OR (status = 'PENDING' AND last_error = ''));
