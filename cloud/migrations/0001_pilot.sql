CREATE TABLE tenants (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  origins TEXT NOT NULL,
  resource_hosts TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  disabled INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  request_key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('ready','running','done','failed','cancelled','interrupted','deleted')),
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  expires_at INTEGER NOT NULL,
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  report TEXT,
  screenshot BLOB,
  UNIQUE(tenant_id, request_key)
);
CREATE INDEX runs_tenant_created ON runs(tenant_id, created_at);
CREATE INDEX runs_created ON runs(created_at);
CREATE INDEX runs_active ON runs(status, created_at);
CREATE INDEX runs_expiry ON runs(expires_at);
