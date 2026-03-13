-- Migration number: 0009  2026-03-13
-- Newsletter subscriptions, daily issue selection, delivery logs, and consent audit trail

CREATE TABLE IF NOT EXISTS newsletter_subscription (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  email_normalized TEXT NOT NULL UNIQUE,
  clerk_user_id TEXT,
  locale TEXT NOT NULL DEFAULT 'fr' CHECK (locale IN ('fr', 'en')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'unsubscribed')),
  source TEXT NOT NULL,
  consent_type TEXT NOT NULL DEFAULT 'express',
  consent_version TEXT NOT NULL,
  consent_copy TEXT NOT NULL,
  subscribed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  resubscribed_at TEXT,
  unsubscribed_at TEXT,
  welcome_sent_at TEXT,
  unsubscribe_confirmation_sent_at TEXT,
  last_daily_sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_newsletter_subscription_status ON newsletter_subscription(status);
CREATE INDEX IF NOT EXISTS idx_newsletter_subscription_locale ON newsletter_subscription(locale);
CREATE INDEX IF NOT EXISTS idx_newsletter_subscription_clerk_user ON newsletter_subscription(clerk_user_id);

CREATE TABLE IF NOT EXISTS newsletter_issue (
  date_key TEXT PRIMARY KEY,
  daily_photo_id TEXT NOT NULL,
  surprise_photo_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS newsletter_delivery (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subscription_id INTEGER NOT NULL,
  issue_date_key TEXT,
  email_type TEXT NOT NULL CHECK (email_type IN ('welcome', 'daily', 'unsubscribe_confirmation')),
  resend_email_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_newsletter_delivery_subscription ON newsletter_delivery(subscription_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_newsletter_delivery_issue ON newsletter_delivery(issue_date_key, email_type, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_newsletter_daily_delivery_once
  ON newsletter_delivery(subscription_id, issue_date_key, email_type)
  WHERE status = 'sent' AND email_type = 'daily';

CREATE TABLE IF NOT EXISTS newsletter_subscription_event (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subscription_id INTEGER,
  email_normalized TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'subscribe',
      'resubscribe',
      'already_subscribed',
      'unsubscribe',
      'rate_limited',
      'daily_send',
      'daily_send_failed',
      'welcome_send',
      'welcome_send_failed',
      'unsubscribe_confirmation_send',
      'unsubscribe_confirmation_send_failed'
    )
  ),
  source TEXT,
  ip_address TEXT,
  user_agent TEXT,
  details_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_newsletter_event_email ON newsletter_subscription_event(email_normalized, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_newsletter_event_ip ON newsletter_subscription_event(ip_address, created_at DESC);
