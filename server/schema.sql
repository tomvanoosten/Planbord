CREATE TABLE IF NOT EXISTS board (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  version INTEGER NOT NULL DEFAULT 0,
  stamp TEXT NOT NULL DEFAULT '',
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  teams TEXT NOT NULL DEFAULT '[]',
  token_hash TEXT NOT NULL UNIQUE,
  expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS notices (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS deliveries (
  notice TEXT NOT NULL,
  member TEXT NOT NULL,
  seen INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(notice,member)
);
CREATE TABLE IF NOT EXISTS subscriptions (
  endpoint TEXT PRIMARY KEY,
  member TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS push_jobs (
  notice TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  retry_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(notice,endpoint)
);
CREATE TABLE IF NOT EXISTS join_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS delivery_member ON deliveries(member,seen);
CREATE INDEX IF NOT EXISTS subscription_member ON subscriptions(member);
