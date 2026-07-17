-- Widget Installs (install beacon)
--
-- Every embedded widget fetches GET /api/widget-config/:companyId on boot. That
-- request carries an Origin header naming the site it loaded on, which is the
-- cheapest reliable signal that a company has put the widget live on their own
-- domain. The backend records one row per (company_id, domain) here and keeps
-- last_seen fresh, giving us both a "trial started" trigger (see demo_funnel)
-- and, via last_seen staleness, a future churn/uninstall signal.
--
-- Additive only: one new table and one new function. Nothing else is touched.
--
-- No FK on company_id on purpose: this is a fire-and-forget write on a hot public
-- endpoint, and a beacon must never be rejected (e.g. for a since-deleted demo
-- company). The poller joins it against demo_funnel/companies in application code.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS widget_installs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    company_id TEXT NOT NULL CHECK (char_length(company_id) <= 100),
    -- Normalized hostname (lowercased, www. stripped) from the request Origin.
    domain TEXT NOT NULL CHECK (char_length(domain) <= 255),

    first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Count of recorded boots. Throttled in the app (~1 write / 10 min per
    -- company+domain), so this is a batch count, not a raw pageview count.
    hits BIGINT NOT NULL DEFAULT 1,

    CONSTRAINT widget_installs_company_domain_unique UNIQUE (company_id, domain)
);

CREATE INDEX IF NOT EXISTS idx_widget_installs_company_id
    ON widget_installs (company_id);

ALTER TABLE widget_installs ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE widget_installs IS 'One row per (company_id, domain) the widget has booted on. Populated by the widget-config endpoint from the request Origin; used to detect real-site installs.';
COMMENT ON COLUMN widget_installs.domain IS 'Normalized hostname (lowercased, leading www. stripped) from the request Origin header.';
COMMENT ON COLUMN widget_installs.hits IS 'Number of recorded boot batches. App-side throttling means this is not a raw pageview count.';

-- Atomic upsert: bump last_seen and hits on a repeat boot, insert on the first.
-- Exists as a function because the hits = hits + 1 increment cannot be expressed
-- through a PostgREST upsert. SECURITY INVOKER (default): the only caller holds
-- the service_role key, so DEFINER would buy nothing and would expose an install-
-- spoofing RPC to the public anon key (see the demo_requests migration).
CREATE OR REPLACE FUNCTION record_widget_install(p_company_id TEXT, p_domain TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO widget_installs (company_id, domain)
    VALUES (p_company_id, p_domain)
    ON CONFLICT (company_id, domain)
    DO UPDATE SET last_seen = NOW(),
                  hits = widget_installs.hits + 1;
END;
$$;

-- Strip the default PUBLIC execute grant so the RPC is never reachable with the
-- anon key, then grant it back to the one role that needs it.
REVOKE EXECUTE ON FUNCTION record_widget_install(TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION record_widget_install(TEXT, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION record_widget_install(TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION record_widget_install(TEXT, TEXT) TO service_role;

REVOKE ALL ON TABLE widget_installs FROM anon;
REVOKE ALL ON TABLE widget_installs FROM authenticated;
GRANT ALL ON TABLE widget_installs TO service_role;
