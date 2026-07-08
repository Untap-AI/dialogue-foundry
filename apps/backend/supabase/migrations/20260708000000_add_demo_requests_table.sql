-- Demo Requests Queue
--
-- The public marketing site (Untap-website) inserts a row here when a prospect
-- submits the demo form. The demo-setup service on the mac-mini polls this
-- table, claims rows, builds the demo, and emails the link. Using a table as
-- the queue keeps the mac-mini off the public internet and makes the row a
-- durable job record that survives pm2 restarts and reboots.
--
-- Additive only: this creates one new table, its indexes, and three new
-- functions. It does not touch companies, chat_configs, chats, messages,
-- analytics_events, or dashboard_users.

-- Prerequisites, both created by 20240601000000_chat_configs_table.sql. Assert
-- rather than CREATE OR REPLACE them: update_updated_at_column() is shared by
-- every other table's trigger, and silently redefining it here would be exactly
-- the kind of cross-table change this migration promises not to make.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_proc
        WHERE proname = 'update_updated_at_column'
          AND pronamespace = 'public'::regnamespace
    ) THEN
        RAISE EXCEPTION 'public.update_updated_at_column() is missing; apply 20240601000000_chat_configs_table.sql first';
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS demo_requests (
    -- ID
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- FORM PAYLOAD
    website_url TEXT NOT NULL CHECK (char_length(website_url) <= 2048),
    company_name TEXT NOT NULL CHECK (char_length(company_name) <= 200),
    contact_email TEXT NOT NULL CHECK (char_length(contact_email) <= 255),
    delivery_email TEXT NOT NULL CHECK (char_length(delivery_email) <= 255),

    -- CONTEXT DATA
    source_path TEXT,
    user_agent TEXT,

    -- DERIVED (set on first claim, reused on retry)
    -- Deliberately NOT a FK to companies(id): the worker persists this before
    -- the pipeline creates the companies row, so a FK would reject the update.
    company_id TEXT CHECK (char_length(company_id) <= 100),
    demo_url TEXT,
    is_prod BOOLEAN NOT NULL DEFAULT TRUE,

    -- QUEUE STATE
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'complete', 'failed')),
    attempts INT NOT NULL DEFAULT 0,
    max_attempts INT NOT NULL DEFAULT 3,
    last_error TEXT,
    claimed_at TIMESTAMPTZ,
    claimed_by TEXT,
    completed_at TIMESTAMPTZ,

    -- METADATA
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ,

    -- CONSTRAINTS
    CONSTRAINT demo_requests_contact_email_format_check CHECK (
        contact_email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
    ),
    CONSTRAINT demo_requests_delivery_email_format_check CHECK (
        delivery_email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
    )
);

-- Partial index matching the claim query's WHERE + ORDER BY exactly.
CREATE INDEX IF NOT EXISTS idx_demo_requests_claimable
    ON demo_requests (created_at)
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_demo_requests_status ON demo_requests (status);
CREATE INDEX IF NOT EXISTS idx_demo_requests_delivery_email ON demo_requests (delivery_email);
CREATE INDEX IF NOT EXISTS idx_demo_requests_company_id ON demo_requests (company_id);

-- Dedupe and throttle in one, with no extra infrastructure: a second request
-- for a site that is already queued or building raises 23505, which the API
-- route turns into a 409. Completed/failed rows are excluded so a site can be
-- re-demoed later.
CREATE UNIQUE INDEX IF NOT EXISTS demo_requests_one_active_per_site
    ON demo_requests (lower(website_url))
    WHERE status IN ('pending', 'processing');

-- Keep updated_at current (function defined in 20240601000000_chat_configs_table.sql).
-- CREATE TRIGGER has no IF NOT EXISTS in PG15, so guard it to stay re-runnable.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'update_demo_requests_updated_at'
          AND tgrelid = 'public.demo_requests'::regclass
    ) THEN
        CREATE TRIGGER update_demo_requests_updated_at
        BEFORE UPDATE ON demo_requests
        FOR EACH ROW
        EXECUTE PROCEDURE update_updated_at_column();
    END IF;
END $$;

-- Service-role access only. No policies are defined on purpose: the earlier
-- remote_schema dump blanket-grants DML on public tables to `anon`, so RLS is
-- the only thing standing between the public anon key and this table.
ALTER TABLE demo_requests ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE demo_requests IS 'Queue of demo build requests submitted from the marketing site. Polled and claimed by the demo-setup worker on the mac-mini.';
COMMENT ON COLUMN demo_requests.contact_email IS 'The prospect''s business contact address. Becomes chat_configs.support_email for the generated demo.';
COMMENT ON COLUMN demo_requests.delivery_email IS 'Where the "your demo is ready" email is sent. Defaults to contact_email when the form leaves it blank.';
COMMENT ON COLUMN demo_requests.company_id IS 'Generated slug (demo-<name>-<rand>). Set on first claim and reused across retries so a retry does not orphan the previous attempt''s S3 objects and Upstash namespace.';
COMMENT ON COLUMN demo_requests.claimed_by IS 'Worker id holding this row. Used by reap_stale_demo_requests to recover rows whose worker died.';
COMMENT ON COLUMN demo_requests.attempts IS 'Incremented on every claim, including reclaims after a stale-claim reap. Once it reaches max_attempts the row is no longer claimable.';

-- Atomically claim up to p_batch pending rows.
--
-- This exists as a function purely because FOR UPDATE SKIP LOCKED cannot be
-- expressed through PostgREST, and SKIP LOCKED is what guarantees two workers
-- (or two concurrent slots in one worker) never grab the same row.
--
-- SECURITY INVOKER (the implicit default) is deliberate. The only caller holds
-- the service_role key, which already bypasses RLS, so SECURITY DEFINER would
-- buy nothing -- and would actively hurt: Postgres grants EXECUTE to PUBLIC by
-- default and Supabase exposes every public-schema function as a PostgREST RPC
-- endpoint, so a definer function here would let anyone holding the *public*
-- anon key claim every row and starve the worker.
CREATE OR REPLACE FUNCTION claim_demo_requests(p_worker TEXT, p_batch INT)
RETURNS SETOF demo_requests
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    UPDATE demo_requests d
       SET status = 'processing',
           claimed_at = NOW(),
           claimed_by = p_worker,
           attempts = d.attempts + 1
     WHERE d.id IN (
         SELECT id
           FROM demo_requests
          WHERE status = 'pending'
            AND attempts < max_attempts
          ORDER BY created_at
          LIMIT p_batch
          FOR UPDATE SKIP LOCKED
     )
    RETURNING d.*;
END;
$$;

-- Recover rows whose worker died mid-job (pm2 restart, reboot, OOM kill).
-- Rows with attempts left go back to 'pending'; exhausted ones go to 'failed'
-- so the worker can alert on them.
CREATE OR REPLACE FUNCTION reap_stale_demo_requests(p_stale_minutes INT)
RETURNS SETOF demo_requests
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    UPDATE demo_requests d
       SET status = CASE WHEN d.attempts >= d.max_attempts THEN 'failed' ELSE 'pending' END,
           last_error = concat_ws(' ', d.last_error, '[reaped: stale claim]'),
           claimed_at = NULL,
           claimed_by = NULL
     WHERE d.status = 'processing'
       AND d.claimed_at < NOW() - make_interval(mins => p_stale_minutes)
    RETURNING d.*;
END;
$$;

-- Hand rows back on graceful shutdown, refunding the attempt the claim consumed.
--
-- Deliberately asymmetric with reap_stale_demo_requests, which does NOT refund:
-- a clean SIGTERM means the attempt never really happened, so charging for it
-- would let three pm2 restarts permanently fail a healthy request. A hard death
-- (crash, OOM, hang) does charge, so a URL that reliably kills the worker
-- exhausts its retries instead of crash-looping forever.
CREATE OR REPLACE FUNCTION release_demo_requests(p_ids UUID[])
RETURNS SETOF demo_requests
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    UPDATE demo_requests d
       SET status = 'pending',
           attempts = GREATEST(d.attempts - 1, 0),
           claimed_at = NULL,
           claimed_by = NULL
     WHERE d.id = ANY(p_ids)
       AND d.status = 'processing'
    RETURNING d.*;
END;
$$;

-- Defense in depth: strip the default PUBLIC execute grant so these are never
-- reachable via PostgREST with the anon key, even if RLS is later misconfigured.
--
-- Order matters. Postgres grants EXECUTE on new functions to PUBLIC, and every
-- role inherits from PUBLIC -- including service_role. So revoking PUBLIC also
-- takes execute away from the worker unless service_role is granted explicitly
-- afterwards. Grant it back below rather than relying on Supabase's default
-- privileges, which are invisible here and easy to change out from under us.
REVOKE EXECUTE ON FUNCTION claim_demo_requests(TEXT, INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION claim_demo_requests(TEXT, INT) FROM anon;
REVOKE EXECUTE ON FUNCTION claim_demo_requests(TEXT, INT) FROM authenticated;
REVOKE EXECUTE ON FUNCTION reap_stale_demo_requests(INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION reap_stale_demo_requests(INT) FROM anon;
REVOKE EXECUTE ON FUNCTION reap_stale_demo_requests(INT) FROM authenticated;
REVOKE EXECUTE ON FUNCTION release_demo_requests(UUID[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION release_demo_requests(UUID[]) FROM anon;
REVOKE EXECUTE ON FUNCTION release_demo_requests(UUID[]) FROM authenticated;

GRANT EXECUTE ON FUNCTION claim_demo_requests(TEXT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION reap_stale_demo_requests(INT) TO service_role;
GRANT EXECUTE ON FUNCTION release_demo_requests(UUID[]) TO service_role;

-- Same reasoning for the table itself.
REVOKE ALL ON TABLE demo_requests FROM anon;
REVOKE ALL ON TABLE demo_requests FROM authenticated;
GRANT ALL ON TABLE demo_requests TO service_role;
