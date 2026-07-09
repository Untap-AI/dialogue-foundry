-- Demo Requests: collapse contact_email + delivery_email into a single email
--
-- The marketing site's demo form now collects exactly one email address, which
-- serves both purposes it used to split: it becomes chat_configs.support_email
-- for the generated demo AND is where the "your demo is ready" link is sent.
-- The two columns have been identical for every row written since the form was
-- simplified, so keep contact_email's value (the one the pipeline maps to
-- support_email), rename it to the now-generic `email`, and drop delivery_email.
--
-- Historical rows where the two differed are all completed/failed, and the
-- rate-limit query only looks back 24h, so nothing operational is lost.

-- Rename contact_email -> email (only if not already done, so this is re-runnable).
-- The inline char_length CHECK and the format CHECK expression both auto-follow
-- the rename; only the format constraint's *name* is stale, fixed below.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'demo_requests' AND column_name = 'contact_email'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'demo_requests' AND column_name = 'email'
    ) THEN
        ALTER TABLE demo_requests RENAME COLUMN contact_email TO email;
    END IF;
END $$;

-- Dropping the column also drops its inline char_length CHECK, its named
-- format-check constraint, and idx_demo_requests_delivery_email.
ALTER TABLE demo_requests DROP COLUMN IF EXISTS delivery_email;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'demo_requests_contact_email_format_check'
    ) THEN
        ALTER TABLE demo_requests
            RENAME CONSTRAINT demo_requests_contact_email_format_check
            TO demo_requests_email_format_check;
    END IF;
END $$;

-- The daily-per-address rate limit used to query delivery_email (now dropped).
-- It queries `email` now, so give that lookup its own index.
CREATE INDEX IF NOT EXISTS idx_demo_requests_email ON demo_requests (email);

COMMENT ON COLUMN demo_requests.email IS 'The prospect''s email. Becomes chat_configs.support_email for the generated demo and is where the "your demo is ready" link is sent. The form collects a single address for both.';
