-- Demo Funnel (post-demo conversion state machine)
--
-- One row per demo company tracking its journey after the demo is built:
-- demo_sent -> trial_offered (first prospect chat) -> nudged -> trial_started
-- (widget detected live on their domain) -> trial_ending -> converted/expired.
--
-- The funnel poller in the demo-setup service (apps/demo-setup) owns this table.
-- Each milestone is its own nullable timestamp so a send is idempotent via a
-- single "WHERE <milestone>_at IS NULL" claim-then-send guard; `stage` is
-- materialized alongside purely for at-a-glance observability.
--
-- Also adds demo_requests.platform, detected from the scraped homepage during
-- the build pipeline, so the trial-offer email can deep-link to the right
-- /install/<platform> guide.
--
-- Additive only: one new column on demo_requests, one new table.

-- Prerequisite shared trigger function (see demo_requests migration for rationale).
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

-- Detected site platform (wordpress, shopify, squarespace, wix, webflow, framer,
-- godaddy, or null when unknown). Nullable; best-effort.
ALTER TABLE demo_requests
    ADD COLUMN IF NOT EXISTS platform TEXT CHECK (char_length(platform) <= 40);

COMMENT ON COLUMN demo_requests.platform IS 'Website platform detected from the scraped homepage during the build pipeline. Deep-links the trial-offer email to the matching install guide.';

CREATE TABLE IF NOT EXISTS demo_funnel (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Keyed by company_id (not demo_request_id) so a site that is re-demoed does
    -- not restart the whole email sequence.
    company_id TEXT NOT NULL UNIQUE CHECK (char_length(company_id) <= 100),
    -- The demo request that seeded this row (latest, informational).
    demo_request_id UUID REFERENCES demo_requests(id),

    -- Prospect + context, copied from demo_requests at backfill so the poller
    -- never has to join to send an email.
    email TEXT NOT NULL CHECK (char_length(email) <= 255),
    website_url TEXT NOT NULL CHECK (char_length(website_url) <= 2048),
    company_name TEXT CHECK (char_length(company_name) <= 200),
    platform TEXT CHECK (char_length(platform) <= 40),

    -- Materialized for observability; the timestamps below are the source of truth.
    stage TEXT NOT NULL DEFAULT 'demo_sent'
        CHECK (stage IN (
            'demo_sent', 'trial_offered', 'nudged', 'trial_started',
            'trial_ending', 'converted', 'expired', 'closed'
        )),

    -- Milestone timestamps. NULL = not yet reached; setting one is the claim.
    demo_completed_at TIMESTAMPTZ NOT NULL,
    first_engaged_at TIMESTAMPTZ,
    trial_offer_sent_at TIMESTAMPTZ,
    nudge_sent_at TIMESTAMPTZ,
    concierge_requested_at TIMESTAMPTZ,
    install_domain TEXT CHECK (char_length(install_domain) <= 255),
    trial_started_at TIMESTAMPTZ,
    trial_ends_at TIMESTAMPTZ,
    trial_started_email_sent_at TIMESTAMPTZ,
    trial_ending_email_sent_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_demo_funnel_stage ON demo_funnel (stage);
CREATE INDEX IF NOT EXISTS idx_demo_funnel_company_id ON demo_funnel (company_id);

-- Keep updated_at current (CREATE TRIGGER lacks IF NOT EXISTS in PG15).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'update_demo_funnel_updated_at'
          AND tgrelid = 'public.demo_funnel'::regclass
    ) THEN
        CREATE TRIGGER update_demo_funnel_updated_at
        BEFORE UPDATE ON demo_funnel
        FOR EACH ROW
        EXECUTE PROCEDURE update_updated_at_column();
    END IF;
END $$;

ALTER TABLE demo_funnel ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE demo_funnel IS 'Post-demo conversion state machine, one row per demo company. Owned by the funnel poller in the demo-setup service.';
COMMENT ON COLUMN demo_funnel.stage IS 'Materialized current stage for observability. The milestone timestamps are the source of truth for transitions.';
COMMENT ON COLUMN demo_funnel.trial_started_at IS 'Set when the widget is first detected live on the prospect''s own domain (widget_installs). This is what "starts" the instant trial.';

REVOKE ALL ON TABLE demo_funnel FROM anon;
REVOKE ALL ON TABLE demo_funnel FROM authenticated;
GRANT ALL ON TABLE demo_funnel TO service_role;
