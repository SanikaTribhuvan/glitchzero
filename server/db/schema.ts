// server/db/schema.ts
// Drizzle ORM table definitions for PostgreSQL (pg-core).
// Run `npx tsx server/db/migrate.ts` once before starting the server.

import {
  pgTable,
  serial,
  text,
  boolean,
  integer,
  real,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ── API Keys ──────────────────────────────────────────────────────────────
export const apiKeys = pgTable("api_keys", {
  id:        serial("id").primaryKey(),
  key:       text("key").notNull().unique(),
  appId:     text("app_id").notNull(),
  name:      text("name").notNull(),
  isActive:  boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Anchors ───────────────────────────────────────────────────────────────
export const anchors = pgTable("anchors", {
  id:                 serial("id").primaryKey(),
  appId:              text("app_id").notNull(),
  userId:             text("user_id").notNull(),
  entityId:           text("entity_id").notNull(),
  payload:            jsonb("payload").notNull(),                                // native JSONB — no stringify needed
  hash:               text("hash").notNull(),
  timestamp:          timestamp("timestamp",   { withTimezone: true }).notNull(),
  createdAt:          timestamp("created_at",  { withTimezone: true }).notNull().defaultNow(),
  riskScore:          real("risk_score").notNull().default(0),
  isFlagged:          boolean("is_flagged").notNull().default(false),
  flagReason:         text("flag_reason"),
  triageClass:        text("triage_class").notNull().default("ROUTINE"),
  xaiFactors:         jsonb("xai_factors").notNull().default(sql`'[]'::jsonb`), // native JSONB array
  selfHealed:         boolean("self_healed").notNull().default(false),
  webhookResult:      text("webhook_result"),
  merkleRoot:         text("merkle_root"),
  blockchainVerified: boolean("blockchain_verified").notNull().default(false),
  blockchainTx:       text("blockchain_tx"),
  latencyMs:          real("latency_ms").notNull().default(0),
}, (table) => ({
  entityIdx:  index("idx_anchors_entity").on(table.appId, table.entityId),
  flaggedIdx: index("idx_anchors_flagged").on(table.isFlagged),
  createdIdx: index("idx_anchors_created").on(table.createdAt),
}));

// ── Merkle Batches ────────────────────────────────────────────────────────
export const merkleBatches = pgTable("merkle_batches", {
  id:          serial("id").primaryKey(),
  anchorIds:   jsonb("anchor_ids").notNull(),                                   // integer[] stored as JSONB
  merkleRoot:  text("merkle_root").notNull(),
  txHash:      text("tx_hash").notNull(),
  network:     text("network").notNull(),
  committedAt: timestamp("committed_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Performance Logs ──────────────────────────────────────────────────────
export const perfLogs = pgTable("perf_logs", {
  id:             serial("id").primaryKey(),
  anchorId:       integer("anchor_id").notNull(),
  latencyMs:      real("latency_ms").notNull(),
  triageClass:    text("triage_class").notNull(),
  isFlagged:      boolean("is_flagged").notNull(),
  riskScore:      real("risk_score").notNull(),
  wasRoutineSkip: boolean("was_routine_skip").notNull(),
  timestamp:      timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  perfCreatedIdx: index("idx_perf_created").on(table.timestamp),
}));
