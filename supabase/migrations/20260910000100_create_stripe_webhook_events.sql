-- Idempotency ledger for Stripe webhooks.
--
-- Stripe retries a webhook until it receives a 2xx and may deliver the same
-- event more than once. Without a record of what has been handled, a replayed
-- event re-applies its side effects. The webhook inserts the event id here
-- first and treats a unique violation as "already processed".

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  id           TEXT PRIMARY KEY,          -- Stripe event id (evt_...)
  type         TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS stripe_webhook_events_processed_at_idx
  ON stripe_webhook_events (processed_at);

-- Only the service role touches this table; keep it unreachable from the
-- anon/authenticated keys the browser holds.
ALTER TABLE stripe_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON stripe_webhook_events FROM anon, authenticated;

-- The subscription upserts use ON CONFLICT (stripe_subscription_id), which
-- requires a unique constraint on that column to be well-defined.
CREATE UNIQUE INDEX IF NOT EXISTS user_subscriptions_stripe_subscription_id_key
  ON user_subscriptions (stripe_subscription_id);
