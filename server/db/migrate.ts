// server/db/migrate.ts
// ═══════════════════════════════════════════════════════════════════════════
//  GlitchZero v6 — PostgreSQL Schema Migration
//
//  Run once before starting the server for the first time:
//    npx tsx server/db/migrate.ts
//
//  Safe to re-run: all statements use CREATE TABLE IF NOT EXISTS / CREATE INDEX
//  IF NOT EXISTS, so running it again on an existing database is a no-op.
//
//  Requires DATABASE_URL in .env pointing to a live Postgres instance
//  (Neon, Supabase, Railway, or a local Postgres container).
// ═══════════════════════════════════════════════════════════════════════════

import "dotenv/config";
import { pool } from "./client.js";

// ── DDL ───────────────────────────────────────────────────────────────────
const DDL = /* sql */ `

  -- ── API Keys ─────────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS api_keys (
    id         SERIAL      PRIMARY KEY,
    key        TEXT        NOT NULL UNIQUE,
    app_id     TEXT        NOT NULL,
    name       TEXT        NOT NULL,
    is_active  BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  -- ── Anchors ───────────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS anchors (
    id                  SERIAL      PRIMARY KEY,
    app_id              TEXT        NOT NULL,
    user_id             TEXT        NOT NULL,
    entity_id           TEXT        NOT NULL,
    payload             JSONB       NOT NULL,                    -- native JSONB: queryable, indexed
    hash                TEXT        NOT NULL,
    "timestamp"         TIMESTAMPTZ NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    risk_score          REAL        NOT NULL DEFAULT 0,
    is_flagged          BOOLEAN     NOT NULL DEFAULT FALSE,
    flag_reason         TEXT,
    triage_class        TEXT        NOT NULL DEFAULT 'ROUTINE',
    xai_factors         JSONB       NOT NULL DEFAULT '[]'::JSONB, -- SHAP-style attribution factors
    self_healed         BOOLEAN     NOT NULL DEFAULT FALSE,
    webhook_result      TEXT,
    merkle_root         TEXT,
    blockchain_verified BOOLEAN     NOT NULL DEFAULT FALSE,
    blockchain_tx       TEXT,
    latency_ms          REAL        NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_anchors_entity  ON anchors(app_id, entity_id);
  CREATE INDEX IF NOT EXISTS idx_anchors_flagged ON anchors(is_flagged);
  CREATE INDEX IF NOT EXISTS idx_anchors_created ON anchors(created_at DESC);

  -- ── Merkle Batches ────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS merkle_batches (
    id           SERIAL      PRIMARY KEY,
    anchor_ids   JSONB       NOT NULL,                           -- integer[] stored as JSONB
    merkle_root  TEXT        NOT NULL,
    tx_hash      TEXT        NOT NULL,
    network      TEXT        NOT NULL,
    committed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  -- ── Performance Logs ──────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS perf_logs (
    id               SERIAL      PRIMARY KEY,
    anchor_id        INTEGER     NOT NULL,
    latency_ms       REAL        NOT NULL,
    triage_class     TEXT        NOT NULL,
    is_flagged       BOOLEAN     NOT NULL,
    risk_score       REAL        NOT NULL,
    was_routine_skip BOOLEAN     NOT NULL,
    "timestamp"      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_perf_created ON perf_logs("timestamp" DESC);

`;

// ── Run ───────────────────────────────────────────────────────────────────
(async () => {
  const client = await pool.connect();
  try {
    console.log("🐘  Connecting to PostgreSQL…");
    const masked = (process.env.DATABASE_URL ?? "").replace(/:\/\/[^@]*@/, "://***@");
    console.log(`   URL: ${masked}\n`);

    await client.query("BEGIN");
    await client.query(DDL);
    await client.query("COMMIT");

    console.log("✅  PostgreSQL schema migrated successfully.");
    console.log("   Tables: api_keys, anchors, merkle_batches, perf_logs");
    console.log("\n   Next step: npm run dev");
  } catch (err: any) {
    await client.query("ROLLBACK");
    console.error("❌  Migration failed:", err?.message ?? err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
})();
