-- Demo-ready email Message-ID
--
-- The build worker stamps a Message-ID on the "your demo is ready" email and
-- stores it here. The funnel's trial-offer email then sends as a reply on that
-- same thread (In-Reply-To / References), so it lands right under the demo the
-- prospect already opened instead of as a cold, separate message.
--
-- Additive only: one nullable column on each of demo_requests and demo_funnel.

ALTER TABLE demo_requests
    ADD COLUMN IF NOT EXISTS demo_ready_message_id TEXT
        CHECK (char_length(demo_ready_message_id) <= 255);

ALTER TABLE demo_funnel
    ADD COLUMN IF NOT EXISTS demo_ready_message_id TEXT
        CHECK (char_length(demo_ready_message_id) <= 255);

COMMENT ON COLUMN demo_requests.demo_ready_message_id IS 'RFC Message-ID stamped on the demo-ready email, so the trial-offer follow-up can thread as a reply.';
COMMENT ON COLUMN demo_funnel.demo_ready_message_id IS 'Copied from demo_requests at backfill; used to thread the trial-offer email onto the demo-ready thread.';
