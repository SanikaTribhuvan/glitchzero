import { z } from "zod";
import { createHash } from "crypto";

// ── Core Types ───────────────────────────────────────────────────────────────

export interface ApiKey {
  id: number; key: string; appId: string; name: string;
  isActive: boolean; createdAt: Date;
}

/**
 * SHAP-style attribution factor.
 * Each factor represents a contributor to the overall risk score,
 * with `weight` normalised so all factors sum to 100.
 */
export interface XAIFactor {
  name: string;        // e.g. "Change Magnitude"
  weight: number;      // 0–100 (percentage share of total risk)
  detail: string;      // human-readable value, e.g. "salary: 55000 → 99000 (Δ80%)"
}

/** Triage classification from the lightweight Isolation Forest pre-filter */
export type TriageClass = "ROUTINE" | "SUSPICIOUS" | "CRITICAL";

export interface Anchor {
  id: number;
  appId: string;
  userId: string;
  entityId: string;
  payload: Record<string, any>;
  hash: string;
  timestamp: Date;
  createdAt: Date;

  // Risk fields
  riskScore: number;
  isFlagged: boolean;
  flagReason: string | null;

  // v4: Triage + XAI
  triageClass: TriageClass;
  xaiFactors: XAIFactor[];

  // v4: Agentic self-healing
  selfHealed: boolean;
  webhookResult: string | null;

  // v4: Blockchain anchoring
  merkleRoot: string | null;
  blockchainVerified: boolean;
  blockchainTx: string | null;

  // v4: Performance tracking
  latencyMs: number;
}

export type CreateAnchorInput = Omit<Anchor, "id" | "createdAt">;

/** One Merkle batch — anchors committed to the simulated ledger */
export interface MerkleBatch {
  id: number;
  anchorIds: number[];
  merkleRoot: string;
  txHash: string;
  network: string;
  committedAt: Date;
}

/** One performance log entry for the research endpoint */
export interface PerfLog {
  anchorId: number;
  latencyMs: number;
  triageClass: TriageClass;
  isFlagged: boolean;
  riskScore: number;
  wasRoutineSkip: boolean;
  timestamp: Date;
}

// ── Zod Schemas ──────────────────────────────────────────────────────────────

export const anchorRequestSchema = z.object({
  app_id:       z.string().min(1),
  user_id:      z.string().min(1),
  entity_id:    z.string().min(1),
  data_payload: z.record(z.any()),
  timestamp:    z.string().datetime(),
});
export type AnchorRequest = z.infer<typeof anchorRequestSchema>;

export const simpleAnchorSchema = z.object({
  userId:  z.string().min(1),
  payload: z.record(z.any()),
});

// ── Hash ─────────────────────────────────────────────────────────────────────

export function hashPayload(payload: Record<string, any>): string {
  const canonical = JSON.stringify(payload, Object.keys(payload).sort());
  return createHash("sha256").update(canonical).digest("hex");
}

// ── Merkle Tree ───────────────────────────────────────────────────────────────
// Binary Merkle tree using SHA-256; Bitcoin-style odd-leaf duplication.
// Deterministic: leaves are combined in sorted order before hashing.

export function buildMerkleRoot(leafHashes: string[]): string {
  if (leafHashes.length === 0) return createHash("sha256").update("empty").digest("hex");
  if (leafHashes.length === 1) return leafHashes[0];

  let level = [...leafHashes];
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left  = level[i];
      const right = i + 1 < level.length ? level[i + 1] : left;
      const pair  = left < right ? left + right : right + left;
      next.push(createHash("sha256").update(pair).digest("hex"));
    }
    level = next;
  }
  return level[0];
}

/** Deterministic simulated Polygon transaction hash */
export function fakePolygonTx(merkleRoot: string): string {
  return "0x" + createHash("sha256")
    .update("polygon-mumbai:" + merkleRoot)
    .digest("hex");
}

// ── API Route Constants ───────────────────────────────────────────────────────

export const API = {
  anchor:        "/api/anchor",
  anchors:       "/api/anchors",
  stats:         "/api/dashboard/stats",
  incidents:     "/api/dashboard/incidents",
  feed:          "/api/dashboard/feed",
  simulateFraud: "/api/simulate-fraud",
  researchData:  "/api/dashboard/research-data",
  merkleBatches: "/api/dashboard/merkle-batches",
} as const;
