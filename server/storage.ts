// server/storage.ts
// ═══════════════════════════════════════════════════════════════════════════
//  GlitchZero v6 — Persistent Storage Layer (PostgreSQL + Drizzle ORM)
//
//  Replaces the v5 SQLite / better-sqlite3 implementation entirely.
//  Uses the `pg` driver (pure JavaScript — no C++ build step, works on
//  Node 24, Render, Railway, and Windows out of the box).
//
//  All Merkle batching, XAI, triage, and performance-logging logic is
//  100% preserved from v5. The public interface is backward-compatible
//  with routes.ts — no changes needed there.
// ═══════════════════════════════════════════════════════════════════════════

import "dotenv/config";
import { eq, desc, and, gte, lt, count, inArray } from "drizzle-orm";
import { randomBytes } from "crypto";
import { db, pool }   from "./db/client.js";
import { anchors, apiKeys, merkleBatches, perfLogs } from "./db/schema.js";
import { buildMerkleRoot } from "../shared/schema.js";
import { anchorMerkleRoot } from "./blockchainService.js";
import type { Anchor, ApiKey, CreateAnchorInput, MerkleBatch, PerfLog } from "../shared/schema.js";

// How many anchors to batch before committing a Merkle root to the blockchain
const MERKLE_BATCH_SIZE = parseInt(process.env.MERKLE_BATCH_SIZE ?? "10");

// ── Row → App-type converters ─────────────────────────────────────────────
// Drizzle with pg returns real Date objects for TIMESTAMPTZ columns and
// native objects for JSONB columns — no JSON.parse / Date construction needed.

function rowToAnchor(row: typeof anchors.$inferSelect): Anchor {
  return {
    id:                 row.id,
    appId:              row.appId,
    userId:             row.userId,
    entityId:           row.entityId,
    payload:            row.payload            as Record<string, any>,
    hash:               row.hash,
    timestamp:          row.timestamp,
    createdAt:          row.createdAt,
    riskScore:          row.riskScore,
    isFlagged:          row.isFlagged,
    flagReason:         row.flagReason         ?? null,
    triageClass:        row.triageClass        as any,
    xaiFactors:         (row.xaiFactors        as any[]) ?? [],
    selfHealed:         row.selfHealed,
    webhookResult:      row.webhookResult      ?? null,
    merkleRoot:         row.merkleRoot         ?? null,
    blockchainVerified: row.blockchainVerified,
    blockchainTx:       row.blockchainTx       ?? null,
    latencyMs:          row.latencyMs,
  };
}

function rowToApiKey(row: typeof apiKeys.$inferSelect): ApiKey {
  return {
    id:        row.id,
    key:       row.key,
    appId:     row.appId,
    name:      row.name,
    isActive:  row.isActive,
    createdAt: row.createdAt,
  };
}

function rowToMerkleBatch(row: typeof merkleBatches.$inferSelect): MerkleBatch {
  return {
    id:          row.id,
    anchorIds:   (row.anchorIds as number[]) ?? [],
    merkleRoot:  row.merkleRoot,
    txHash:      row.txHash,
    network:     row.network,
    committedAt: row.committedAt,
  };
}

function rowToPerfLog(row: typeof perfLogs.$inferSelect): PerfLog {
  return {
    anchorId:       row.anchorId,
    latencyMs:      row.latencyMs,
    triageClass:    row.triageClass as any,
    isFlagged:      row.isFlagged,
    riskScore:      row.riskScore,
    wasRoutineSkip: row.wasRoutineSkip,
    timestamp:      row.timestamp,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PostgresStorage — drop-in replacement for SQLiteStorage
// ─────────────────────────────────────────────────────────────────────────────
class PostgresStorage {

  // ── API Keys ─────────────────────────────────────────────────────────────

  async getApiKey(key: string): Promise<ApiKey | undefined> {
    const [row] = await db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.key, key))
      .limit(1);
    return row ? rowToApiKey(row) : undefined;
  }

  async getAllApiKeys(): Promise<ApiKey[]> {
    const rows = await db
      .select()
      .from(apiKeys)
      .orderBy(desc(apiKeys.createdAt));
    return rows.map(rowToApiKey);
  }

  async createApiKey(name: string, appId: string): Promise<ApiKey> {
    const key = "gz_" + randomBytes(20).toString("hex");
    const [row] = await db
      .insert(apiKeys)
      .values({ key, appId, name, isActive: true, createdAt: new Date() })
      .returning();
    return rowToApiKey(row);
  }

  async revokeApiKey(key: string): Promise<boolean> {
    const result = await db
      .update(apiKeys)
      .set({ isActive: false })
      .where(eq(apiKeys.key, key))
      .returning({ id: apiKeys.id });
    return result.length > 0;
  }

  async deleteApiKey(key: string): Promise<boolean> {
    const result = await db
      .delete(apiKeys)
      .where(eq(apiKeys.key, key))
      .returning({ id: apiKeys.id });
    return result.length > 0;
  }

  // ── Anchors ──────────────────────────────────────────────────────────────

  async createAnchor(input: CreateAnchorInput): Promise<Anchor> {
    const [row] = await db
      .insert(anchors)
      .values({
        appId:              input.appId,
        userId:             input.userId,
        entityId:           input.entityId,
        payload:            input.payload,           // object goes straight to JSONB
        hash:               input.hash,
        timestamp:          input.timestamp,
        createdAt:          new Date(),
        riskScore:          input.riskScore,
        isFlagged:          input.isFlagged,
        flagReason:         input.flagReason         ?? null,
        triageClass:        input.triageClass,
        xaiFactors:         input.xaiFactors,        // array goes straight to JSONB
        selfHealed:         input.selfHealed,
        webhookResult:      input.webhookResult      ?? null,
        merkleRoot:         input.merkleRoot         ?? null,
        blockchainVerified: input.blockchainVerified,
        blockchainTx:       input.blockchainTx       ?? null,
        latencyMs:          input.latencyMs,
      })
      .returning();

    const anchor = rowToAnchor(row);

    // Merkle batch trigger — every MERKLE_BATCH_SIZE anchors
    const [{ total }] = await db.select({ total: count() }).from(anchors);
    if (Number(total) % MERKLE_BATCH_SIZE === 0) {
      await this._commitMerkleBatch();
      // Re-fetch so the returned anchor has the merkle fields populated
      const [refreshed] = await db
        .select()
        .from(anchors)
        .where(eq(anchors.id, anchor.id))
        .limit(1);
      return rowToAnchor(refreshed);
    }

    return anchor;
  }

  // Called by routes.ts after agentic mitigation to persist self-heal results
  async updateAnchorPostAgentic(
    id: number,
    selfHealed: boolean,
    webhookResult: string,
    latencyMs: number,
  ): Promise<void> {
    await db
      .update(anchors)
      .set({ selfHealed, webhookResult, latencyMs })
      .where(eq(anchors.id, id));
  }

  // Commits a Merkle batch: takes the last N anchors, builds a Merkle root,
  // sends it to the blockchain service, then updates all anchor rows.
  private async _commitMerkleBatch(): Promise<void> {
    const rows = await db
      .select({ id: anchors.id, hash: anchors.hash })
      .from(anchors)
      .orderBy(desc(anchors.id))
      .limit(MERKLE_BATCH_SIZE);

    if (rows.length === 0) return;
    rows.reverse(); // oldest → newest for deterministic root

    const anchorIdList = rows.map((r) => r.id);
    const leafHashes   = rows.map((r) => r.hash);
    const merkleRoot   = buildMerkleRoot(leafHashes);
    const bcResult     = await anchorMerkleRoot(merkleRoot);

    // Persist the batch record
    await db.insert(merkleBatches).values({
      anchorIds:   anchorIdList,
      merkleRoot,
      txHash:      bcResult.txHash,
      network:     bcResult.network,
      committedAt: new Date(),
    });

    // Stamp every anchor in the batch with the root + tx
    await db
      .update(anchors)
      .set({ merkleRoot, blockchainVerified: true, blockchainTx: bcResult.txHash })
      .where(inArray(anchors.id, anchorIdList));

    const tag = bcResult.simulated ? "(simulated)" : "✅ LIVE";
    console.log(
      `  ⛓  Merkle batch committed ${tag} | root: ${merkleRoot.slice(0, 18)}… | tx: ${bcResult.txHash.slice(0, 20)}…`
    );
    if (!bcResult.simulated) console.log(`       🔗 ${bcResult.explorerUrl}`);
  }

  async getLatestAnchorForEntity(
    appId: string,
    entityId: string,
  ): Promise<Anchor | undefined> {
    const [row] = await db
      .select()
      .from(anchors)
      .where(and(eq(anchors.appId, appId), eq(anchors.entityId, entityId)))
      .orderBy(desc(anchors.timestamp))
      .limit(1);
    return row ? rowToAnchor(row) : undefined;
  }

  async getRecentAnchors(limit = 100): Promise<Anchor[]> {
    const rows = await db
      .select()
      .from(anchors)
      .orderBy(desc(anchors.createdAt))
      .limit(limit);
    return rows.map(rowToAnchor);
  }

  async getFlaggedIncidents(limit = 50): Promise<Anchor[]> {
    const rows = await db
      .select()
      .from(anchors)
      .where(eq(anchors.isFlagged, true))
      .orderBy(desc(anchors.createdAt))
      .limit(limit);
    return rows.map(rowToAnchor);
  }

  async getMerkleBatches(): Promise<MerkleBatch[]> {
    const rows = await db
      .select()
      .from(merkleBatches)
      .orderBy(desc(merkleBatches.id));
    return rows.map(rowToMerkleBatch);
  }

  async getStats() {
    const [{ total }]      = await db.select({ total:      count() }).from(anchors);
    const [{ flagged }]    = await db.select({ flagged:    count() }).from(anchors).where(eq(anchors.isFlagged, true));
    const [{ healed }]     = await db.select({ healed:     count() }).from(anchors).where(eq(anchors.selfHealed, true));
    const [{ bcCount }]    = await db.select({ bcCount:    count() }).from(anchors).where(eq(anchors.blockchainVerified, true));
    const [{ batchCount }] = await db.select({ batchCount: count() }).from(merkleBatches);

    const t = Number(total);
    const f = Number(flagged);
    const trustScore = t > 0 ? Math.max(0, Math.round(100 - (f / t) * 100)) : 100;

    // Build 12 × 5-minute time-bucket histogram for the dashboard sparkline
    const now = Date.now();
    const history = await Promise.all(
      Array.from({ length: 12 }, async (_, i) => {
        const start = new Date(now - (12 - i) * 5 * 60_000);
        const end   = new Date(start.getTime() + 5 * 60_000);
        const [{ c }] = await db
          .select({ c: count() })
          .from(anchors)
          .where(and(gte(anchors.createdAt, start), lt(anchors.createdAt, end)));
        return {
          time:  start.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false }),
          count: Number(c),
        };
      })
    );

    return {
      totalRequests:          t,
      flaggedIncidents:       f,
      trustScore,
      selfHealedCount:        Number(healed),
      blockchainVerifiedCount: Number(bcCount),
      merkleBatchCount:       Number(batchCount),
      requestsHistory:        history,
    };
  }

  async logPerf(entry: Omit<PerfLog, "timestamp">): Promise<void> {
    await db.insert(perfLogs).values({
      anchorId:       entry.anchorId,
      latencyMs:      entry.latencyMs,
      triageClass:    entry.triageClass,
      isFlagged:      entry.isFlagged,
      riskScore:      entry.riskScore,
      wasRoutineSkip: entry.wasRoutineSkip,
      timestamp:      new Date(),
    });
  }

  async getResearchData() {
    const allRows = await db
      .select()
      .from(perfLogs)
      .orderBy(perfLogs.timestamp);
    const logs  = allRows.map(rowToPerfLog);
    const total = logs.length;

    const RISK_THRESHOLD = 50;
    const tp = logs.filter((l) =>  l.isFlagged && l.riskScore >= RISK_THRESHOLD).length;
    const fp = logs.filter((l) =>  l.isFlagged && l.riskScore <  RISK_THRESHOLD).length;
    const tn = logs.filter((l) => !l.isFlagged && l.riskScore <  RISK_THRESHOLD).length;
    const fn = logs.filter((l) => !l.isFlagged && l.riskScore >= RISK_THRESHOLD).length;

    const precision  = (tp + fp) > 0 ? tp / (tp + fp) : 0;
    const recall     = (tp + fn) > 0 ? tp / (tp + fn) : 0;
    const f1         = (precision + recall) > 0 ? 2 * (precision * recall) / (precision + recall) : 0;
    const accuracy   = total > 0 ? (tp + tn) / total : 0;

    const latencies  = logs.map((l) => l.latencyMs).sort((a, b) => a - b);
    const avg = latencies.length ? latencies.reduce((s, v) => s + v, 0) / latencies.length : 0;
    const p50 = latencies[Math.floor(latencies.length * 0.50)] ?? 0;
    const p95 = latencies[Math.floor(latencies.length * 0.95)] ?? 0;
    const p99 = latencies[Math.floor(latencies.length * 0.99)] ?? 0;

    const routine    = logs.filter((l) => l.triageClass === "ROUTINE").length;
    const suspicious = logs.filter((l) => l.triageClass === "SUSPICIOUS").length;
    const critical   = logs.filter((l) => l.triageClass === "CRITICAL").length;
    const skipped    = logs.filter((l) => l.wasRoutineSkip).length;
    const batches    = await this.getMerkleBatches();

    return {
      meta: {
        system:       "GlitchZero v6 Production PostgreSQL",
        generatedAt:  new Date().toISOString(),
        totalSamples: total,
        description:  "Research-grade metrics — persisted in PostgreSQL across restarts",
      },
      classification_metrics: {
        true_positives: tp, false_positives: fp,
        true_negatives: tn, false_negatives: fn,
        precision:  +precision.toFixed(4),
        recall:     +recall.toFixed(4),
        f1_score:   +f1.toFixed(4),
        accuracy:   +accuracy.toFixed(4),
      },
      latency_metrics: {
        avg_ms: +avg.toFixed(2), p50_ms: +p50.toFixed(2),
        p95_ms: +p95.toFixed(2), p99_ms: +p99.toFixed(2),
        unit: "milliseconds",
      },
      triage_distribution: {
        ROUTINE:    { count: routine,    pct: total ? +((routine    / total) * 100).toFixed(1) : 0 },
        SUSPICIOUS: { count: suspicious, pct: total ? +((suspicious / total) * 100).toFixed(1) : 0 },
        CRITICAL:   { count: critical,   pct: total ? +((critical   / total) * 100).toFixed(1) : 0 },
        audit_skipped_by_triage: skipped,
        audit_skip_rate_pct: total ? +((skipped / total) * 100).toFixed(1) : 0,
      },
      blockchain_metrics: {
        batches_committed:      batches.length,
        anchors_per_batch:      MERKLE_BATCH_SIZE,
        total_anchors_verified: batches.reduce((s, b) => s + b.anchorIds.length, 0),
        blockchain_mode:        process.env.BLOCKCHAIN_MODE ?? "simulated",
        recent_batches: batches.slice(0, 5).map((b) => ({
          batch_id:    b.id,
          anchor_ids:  b.anchorIds,
          merkle_root: b.merkleRoot,
          tx_hash:     b.txHash,
          network:     b.network,
          explorer_url: `https://amoy.polygonscan.com/tx/${b.txHash}`,
          committed_at: b.committedAt,
        })),
      },
      per_request_log: logs.slice(-50).map((l) => ({
        anchor_id:    l.anchorId,
        latency_ms:   l.latencyMs,
        triage_class: l.triageClass,
        is_flagged:   l.isFlagged,
        risk_score:   l.riskScore,
        routine_skip: l.wasRoutineSkip,
        timestamp:    l.timestamp,
      })),
    };
  }
}

export const storage = new PostgresStorage();

// ── Database boot / seed ──────────────────────────────────────────────────

export async function seedDatabase() {
  // Verify we can connect at all
  try {
    await pool.query("SELECT 1");
  } catch (err: any) {
    console.error("\n  ❌  Cannot connect to PostgreSQL:", err?.message);
    console.error("     Check DATABASE_URL in your .env file.\n");
    process.exit(1);
  }

  // Seed the master API key from .env if configured
  const masterKey = process.env.MASTER_API_KEY;
  if (masterKey && masterKey !== "gz_master_change_me_in_production") {
    const existing = await db
      .select({ id: apiKeys.id })
      .from(apiKeys)
      .where(eq(apiKeys.key, masterKey))
      .limit(1);
    if (existing.length === 0) {
      await db.insert(apiKeys).values({
        key: masterKey, appId: "master",
        name: "Master Key (from .env)",
        isActive: true, createdAt: new Date(),
      });
      console.log("  🔑  Master API key seeded from MASTER_API_KEY");
    }
  }

  const [{ total }] = await db.select({ total: count() }).from(anchors);
  const mode = process.env.BLOCKCHAIN_MODE ?? "simulated";
  const masked = (process.env.DATABASE_URL ?? "").replace(/:\/\/[^@]*@/, "://***@");

  console.log(`\n  ✅  GlitchZero v6 — PostgreSQL storage ready`);
  console.log(`  🐘  DB: ${masked}`);
  console.log(`  ⛓   Blockchain: ${mode.toUpperCase()}`);
  console.log(`  📊  Anchors in DB: ${total}`);
}
