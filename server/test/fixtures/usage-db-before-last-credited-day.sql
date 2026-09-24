-- usage.db as the server wrote it before `usage.last_credited_day` existed (legal-surface-v2 D9).
-- Produced by running NodeSqliteUsageStore at a6b63c1 (credit, admit, settle, recordCost and refund
-- against a file database), then dumping sqlite_master's statements verbatim and every row in rowid
-- order. device-records.suite.ts replays it to check the migration against the real pre-change shape.
CREATE TABLE usage (
        device_id TEXT PRIMARY KEY,
        prompt_tokens INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0
      );
CREATE TABLE requests (
        id TEXT PRIMARY KEY,
        device_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        utc_day TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        outcome TEXT,
        prompt_tokens INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL,
        cost_state TEXT NOT NULL CHECK(cost_state IN ('pending','resolved','unresolved')),
        generation_ids TEXT,
        refunded INTEGER NOT NULL DEFAULT 0
      );
CREATE INDEX idx_requests_day_kind_device
      ON requests (utc_day, kind, device_id)
    ;
INSERT INTO usage (device_id, prompt_tokens, completion_tokens, total_tokens) VALUES ('0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a', 2000, 4000, 6000);
INSERT INTO usage (device_id, prompt_tokens, completion_tokens, total_tokens) VALUES ('0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b', 51, 7, 58);
INSERT INTO usage (device_id, prompt_tokens, completion_tokens, total_tokens) VALUES ('0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c0c', 90210, 12345, 102555);
INSERT INTO requests (id, device_id, kind, utc_day, started_at, ended_at, outcome, prompt_tokens, completion_tokens, cost_usd, cost_state, generation_ids, refunded) VALUES ('req-0001', '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a', 'generate', '2026-07-20', 1784556000000, 1784556030000, 'delivered', 1200, 3400, 0.0123, 'resolved', NULL, 0);
INSERT INTO requests (id, device_id, kind, utc_day, started_at, ended_at, outcome, prompt_tokens, completion_tokens, cost_usd, cost_state, generation_ids, refunded) VALUES ('req-0002', '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a', 'clarify', '2026-07-21', 1784642400000, 1784642430000, 'ok', 800, 600, NULL, 'unresolved', '["gen-a2","gen-a3"]', 0);
INSERT INTO requests (id, device_id, kind, utc_day, started_at, ended_at, outcome, prompt_tokens, completion_tokens, cost_usd, cost_state, generation_ids, refunded) VALUES ('req-0003', '0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b', 'generate', '2026-07-22', 1784728800000, 1784728830000, 'failed', 51, 7, 0.0004, 'resolved', NULL, 1);
INSERT INTO requests (id, device_id, kind, utc_day, started_at, ended_at, outcome, prompt_tokens, completion_tokens, cost_usd, cost_state, generation_ids, refunded) VALUES ('req-0004', '0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c0c', 'report', '2026-07-23', 1784815200000, 1784815230000, 'ok', 0, 0, NULL, 'pending', NULL, 0);
INSERT INTO requests (id, device_id, kind, utc_day, started_at, ended_at, outcome, prompt_tokens, completion_tokens, cost_usd, cost_state, generation_ids, refunded) VALUES ('req-0005', '0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c0c', 'generate', '2026-07-23', 1784815200000, 1784815230000, 'delivered', 90210, 12345, NULL, 'pending', '["gen-c1"]', 0);
INSERT INTO requests (id, device_id, kind, utc_day, started_at, ended_at, outcome, prompt_tokens, completion_tokens, cost_usd, cost_state, generation_ids, refunded) VALUES ('req-0006', '0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c0c', 'rewrite', '2026-07-24', 1784901600000, NULL, NULL, 0, 0, NULL, 'pending', NULL, 0);
