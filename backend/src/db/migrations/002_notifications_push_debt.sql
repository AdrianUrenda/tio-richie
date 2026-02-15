-- Tío Richie migration 002 — Push subscriptions, notification metadata, debt goal fields

-- Push subscription storage (one user can have multiple browsers/devices)
CREATE TABLE push_subscriptions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint    TEXT NOT NULL UNIQUE,
  keys_p256dh TEXT NOT NULL,
  keys_auth   TEXT NOT NULL,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_push_subscriptions_user_id ON push_subscriptions(user_id);

-- Notifications: add metadata column for contextual chat linking
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}';

-- Goals: add debt-specific fields for FR-504 / flow 7.4
ALTER TABLE goals ADD COLUMN IF NOT EXISTS interest_rate DECIMAL(6,4);
ALTER TABLE goals ADD COLUMN IF NOT EXISTS minimum_payment DECIMAL(15,2);
ALTER TABLE goals ADD COLUMN IF NOT EXISTS current_balance DECIMAL(15,2);
ALTER TABLE goals ADD COLUMN IF NOT EXISTS payment_due_day INTEGER;
ALTER TABLE goals ADD COLUMN IF NOT EXISTS debt_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL;
ALTER TABLE goals ADD COLUMN IF NOT EXISTS milestones JSONB NOT NULL DEFAULT '[]';
