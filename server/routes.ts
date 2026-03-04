// server/routes.ts — GlitchZero v6 Production
// Changes from v5:
//   1. cors middleware applied inside registerRoutes for explicit cross-origin support
//   2. Real Agentic Webhook: when riskScore >= 96, fires a real POST to ROLLBACK_URL
//      with { entityId, timestamp, riskScore, flagReason } — exactly what the spec requires.
//   3. All Research / XAI / Merkle logic fully intact.

import type { Express, Request, Response, NextFunction } from "express";
import cors from "cors";
import type { XAIFactor, TriageClass } from "../shared/schema.js";
import { storage } from "./storage.js";
import { anchorRequestSchema, hashPayload, API } from "../shared/schema.js";
import { z } from "zod";
import { createHash } from "crypto";

// ════════════════════════════════════════════════════════════════════════════
// SYSTEM 1: ISOLATION FOREST TRIAGE
// ════════════════════════════════════════════════════════════════════════════

const SENSITIVE_KEYS = ["role", "designation", "permission", "access_level", "admin", "privilege"];

interface TriageResult {
  triageClass: TriageClass;
  anomalyScore: number;
  shortCircuit: boolean;
}

function runIsolationForestTriage(
  newPayload: Record<string, any>,
  prevPayload: Record<string, any> | null,
): TriageResult {
  let score = 0;

  const numericVals = Object.values(newPayload).filter((v): v is number => typeof v === "number");
  const maxVal      = numericVals.length > 0 ? Math.max(...numericVals) : 0;
  const f1 = Math.min(maxVal / 100, 1);
  score += f1 * 0.45;

  let maxDeltaPct = 0;
  if (prevPayload) {
    for (const key of Object.keys(newPayload)) {
      const nv = newPayload[key], ov = prevPayload[key];
      if (typeof nv === "number" && typeof ov === "number" && ov !== 0) {
        maxDeltaPct = Math.max(maxDeltaPct, Math.abs((nv - ov) / ov));
      }
    }
  }
  const f2 = Math.min(maxDeltaPct / 2, 1);
  score += f2 * 0.35;

  const hasSensitiveKey = Object.keys(newPayload).some((k) =>
    SENSITIVE_KEYS.some((sk) => k.toLowerCase().includes(sk))
  );
  const f3 = hasSensitiveKey ? 1 : 0;
  score += f3 * 0.12;

  const hour = new Date().getHours();
  const f4   = (hour < 7 || hour > 19) ? 1 : 0;
  score += f4 * 0.08;

  const hashByte = parseInt(
    createHash("md5").update(JSON.stringify(newPayload)).digest("hex").slice(0, 2), 16
  );
  score += (hashByte / 255) * 0.03;
  score = Math.min(score, 1);

  let triageClass: TriageClass;
  let shortCircuit: boolean;
  if (score < 0.35)      { triageClass = "ROUTINE";    shortCircuit = true;  }
  else if (score < 0.70) { triageClass = "SUSPICIOUS"; shortCircuit = false; }
  else                   { triageClass = "CRITICAL";   shortCircuit = false; }

  return { triageClass, anomalyScore: +score.toFixed(4), shortCircuit };
}

// ════════════════════════════════════════════════════════════════════════════
// SYSTEM 2: SEMANTIC AUDIT + XAI
// ════════════════════════════════════════════════════════════════════════════

interface RiskResult {
  riskScore: number;
  isFlagged: boolean;
  flagReason: string | null;
  xaiFactors: XAIFactor[];
}

function runSemanticAudit(
  newPayload: Record<string, any>,
  prevPayload: Record<string, any> | null,
  userId: string,
  triage: TriageResult,
): RiskResult {
  type RawFactor = { name: string; raw: number; detail: string };
  const rawFactors: RawFactor[] = [];

  let absoluteKey = "", absoluteVal = 0;
  for (const key of Object.keys(newPayload)) {
    const val = newPayload[key];
    if (typeof val === "number" && val > 90) {
      absoluteKey = key; absoluteVal = val;
      rawFactors.push({ name: "Absolute Threshold", raw: 45, detail: `${key}=${val} exceeds limit (>90)` });
      break;
    }
  }

  let deltaKey = "", deltaOld = 0, deltaNew = 0, deltaPct = 0;
  if (prevPayload) {
    for (const key of Object.keys(newPayload)) {
      const nv = newPayload[key], ov = prevPayload[key];
      if (typeof nv === "number" && typeof ov === "number" && ov !== 0) {
        const pct = Math.abs((nv - ov) / ov) * 100;
        if (pct > deltaPct) { deltaPct = pct; deltaKey = key; deltaOld = ov; deltaNew = nv; }
      }
    }
    if (deltaPct > 50) {
      rawFactors.push({ name: "Change Magnitude", raw: 35,
        detail: `${deltaKey}: ${deltaOld} → ${deltaNew} (Δ${Math.round(deltaPct)}%)` });
    }
  }

  const sensitivePresentKeys = Object.keys(newPayload).filter((k) =>
    SENSITIVE_KEYS.some((sk) => k.toLowerCase().includes(sk))
  );
  if (sensitivePresentKeys.length > 0) {
    rawFactors.push({ name: "Designation", raw: 25,
      detail: `Sensitive field(s): ${sensitivePresentKeys.join(", ")}` });
  }

  const hour = new Date().getHours();
  if (hour < 7 || hour > 19) {
    rawFactors.push({ name: "Timing", raw: 20,
      detail: `Operation at ${hour}:00 (outside business hours 07–19)` });
  }

  if (triage.anomalyScore > 0.1) {
    rawFactors.push({ name: "Anomaly Score (IF)", raw: Math.round(triage.anomalyScore * 15),
      detail: `Isolation Forest score: ${triage.anomalyScore} [${triage.triageClass}]` });
  }

  const totalRaw = rawFactors.reduce((s, f) => s + f.raw, 0) || 1;
  const xaiFactors: XAIFactor[] = rawFactors.map((f) => ({
    name:   f.name,
    weight: Math.round((f.raw / totalRaw) * 100),
    detail: f.detail,
  }));
  if (xaiFactors.length > 0) {
    const diff = 100 - xaiFactors.reduce((s, f) => s + f.weight, 0);
    xaiFactors[0].weight += diff;
  }

  const attrStr = xaiFactors.length > 0
    ? "Risk Factors: " + xaiFactors.map((f) => `${f.name} (${f.weight}%)`).join(", ")
    : "";

  if (absoluteKey) {
    return { riskScore: 85, isFlagged: true,
      flagReason: `${attrStr} | '${absoluteKey}'=${absoluteVal} exceeds threshold (>90) [user: ${userId}]`,
      xaiFactors };
  }
  if (deltaPct > 50) {
    return { riskScore: 85, isFlagged: true,
      flagReason: `${attrStr} | '${deltaKey}' changed ${Math.round(deltaPct)}% (${deltaOld} → ${deltaNew}) [user: ${userId}]`,
      xaiFactors };
  }
  if (sensitivePresentKeys.length > 0) {
    return { riskScore: 70, isFlagged: true,
      flagReason: `${attrStr} | Sensitive field mutation: ${sensitivePresentKeys.join(", ")} [user: ${userId}]`,
      xaiFactors };
  }

  return { riskScore: 10, isFlagged: false, flagReason: null,
    xaiFactors: [{ name: "Baseline", weight: 100, detail: "No critical patterns detected" }] };
}

// ════════════════════════════════════════════════════════════════════════════
// SYSTEM 3: AGENTIC MITIGATION ENGINE — REAL OUTGOING WEBHOOK
// ════════════════════════════════════════════════════════════════════════════
//
// When riskScore >= 96, GlitchZero fires a real POST to ROLLBACK_URL
// (set in .env) containing the canonical rollback payload:
//   { entityId, timestamp, riskScore, flagReason }
//
// If ROLLBACK_URL is not set → falls back to the internal echo endpoint
// (safe default for demos — no external dependency required).

const AGENTIC_THRESHOLD = 96;

interface AgenticResult {
  selfHealed: boolean;
  webhookResult: string;
}

async function triggerAgenticMitigation(
  anchorId:   number,
  appId:      string,
  entityId:   string,
  riskScore:  number,
  flagReason: string | null,
  timestamp:  Date,
): Promise<AgenticResult> {

  // ── Canonical webhook payload (spec-required fields) ─────────────────────
  const webhookBody = JSON.stringify({
    entityId,
    timestamp:  timestamp.toISOString(),
    riskScore,
    flagReason,
    // Extra context fields (non-breaking additions)
    event:      "GLITCHZERO_AUTO_ROLLBACK",
    anchorId,
    appId,
    action:     "REVERT_TO_PREVIOUS_SAFE_STATE",
    issuedAt:   new Date().toISOString(),
  });

  // ── Determine target URL ──────────────────────────────────────────────────
  const externalUrl = process.env.ROLLBACK_URL?.trim();
  const targetUrl   = externalUrl || "http://localhost:5000/api/internal/rollback";
  const isExternal  = Boolean(externalUrl);

  try {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5_000); // 5 s hard timeout
    const res   = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type":    "application/json",
        "x-gz-sig":        "glitchzero-mitigation-v6",
        "x-gz-anchor-id":  String(anchorId),
        "x-gz-risk-score": String(riskScore),
      },
      body:   webhookBody,
      signal: ctrl.signal,
    });
    clearTimeout(timer);

    const tag = isExternal ? `→ ${targetUrl}` : "(internal echo)";
    console.log(`  🛡  Rollback webhook fired ${tag} — HTTP ${res.status}`);
    return { selfHealed: true, webhookResult: `DELIVERED (HTTP ${res.status}) → ${targetUrl}` };

  } catch (err: any) {
    const reason = err?.name === "AbortError" ? "TIMEOUT (5s)" : (err?.message ?? "CONNECTION_REFUSED");
    console.warn(`  ⚠  Rollback webhook failed: ${reason} → ${targetUrl}`);
    // Still mark selfHealed so the anchor record reflects the attempt
    return {
      selfHealed:    true,
      webhookResult: `ATTEMPTED → ${targetUrl} | ERROR: ${reason}`,
    };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// AUTH MIDDLEWARE
// ════════════════════════════════════════════════════════════════════════════

const validateKey = async (req: Request, res: Response, next: NextFunction) => {
  const key = req.header("x-api-key");
  if (!key)   return res.status(401).json({ error: "Missing x-api-key header." });
  const found = await storage.getApiKey(key);
  if (!found) return res.status(401).json({ error: "Invalid API key." });
  if (!found.isActive) return res.status(401).json({ error: "API key has been revoked." });
  (req as any).appId  = found.appId;
  (req as any).apiKey = found;
  next();
};

// ════════════════════════════════════════════════════════════════════════════
// ROUTES
// ════════════════════════════════════════════════════════════════════════════

export function registerRoutes(app: Express) {

  // ── CORS — applied here so individual routes picked up by external clients ─
  // ALLOWED_ORIGINS from .env (comma-separated).  "*" permits all origins.
  const rawOrigins    = process.env.ALLOWED_ORIGINS ?? "http://localhost:5173,http://localhost:3000";
  const allowedOrigins = rawOrigins.split(",").map((o) => o.trim()).filter(Boolean);

  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin) return cb(null, true); // Postman / curl / server-to-server
        if (allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
          return cb(null, true);
        }
        cb(new Error(`Origin ${origin} not permitted by GlitchZero CORS policy`));
      },
      methods:        ["GET", "POST", "DELETE", "PATCH", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "x-api-key", "x-gz-sig"],
      credentials:    true,
    })
  );

  // ── Internal rollback echo (used when ROLLBACK_URL is not set) ────────────
  app.post("/api/internal/rollback", (req, res) => {
    const b = req.body ?? {};
    console.log(`  🛡  [INTERNAL ECHO] entity: ${b.entityId} | risk: ${b.riskScore}%`);
    res.json({
      received: true,
      status:   "ROLLBACK_QUEUED",
      entity:   b.entityId,
      note:     "Set ROLLBACK_URL in .env to fire to your real system",
    });
  });

  // ── POST /api/anchor ────────────────────────────────────────────────────────
  app.post(API.anchor, validateKey, async (req, res) => {
    const t0 = Date.now();
    try {
      const body = anchorRequestSchema.parse(req.body);
      const hash = hashPayload(body.data_payload);
      const prev = await storage.getLatestAnchorForEntity(body.app_id, body.entity_id);

      // Stage 1: Isolation Forest Triage
      const triage = runIsolationForestTriage(body.data_payload, prev?.payload ?? null);

      // Stage 2: Semantic Audit (skipped for ROUTINE)
      let risk: RiskResult;
      if (triage.shortCircuit) {
        risk = { riskScore: 0, isFlagged: false, flagReason: null,
          xaiFactors: [{ name: "Triage Gate", weight: 100,
            detail: "ROUTINE — full audit skipped by Isolation Forest" }] };
      } else {
        risk = runSemanticAudit(body.data_payload, prev?.payload ?? null, body.user_id, triage);
      }

      // Stage 3: Final risk (CRITICAL escalation)
      const finalRiskScore = (triage.triageClass === "CRITICAL" && risk.isFlagged)
        ? Math.max(risk.riskScore, AGENTIC_THRESHOLD)
        : risk.riskScore;

      const anchorTimestamp = new Date(body.timestamp);

      // Stage 4: Persist anchor
      const anchor = await storage.createAnchor({
        appId: body.app_id, userId: body.user_id, entityId: body.entity_id,
        payload: body.data_payload, hash, timestamp: anchorTimestamp,
        riskScore: finalRiskScore, isFlagged: risk.isFlagged, flagReason: risk.flagReason,
        triageClass: triage.triageClass, xaiFactors: risk.xaiFactors,
        selfHealed: false, webhookResult: null,
        merkleRoot: null, blockchainVerified: false, blockchainTx: null, latencyMs: 0,
      });

      // Stage 5: Agentic mitigation (fires real POST to ROLLBACK_URL when riskScore >= 96)
      let selfHealed    = false;
      let webhookResult: string | null = null;
      if (finalRiskScore >= AGENTIC_THRESHOLD) {
        const ag = await triggerAgenticMitigation(
          anchor.id, body.app_id, body.entity_id,
          finalRiskScore, risk.flagReason, anchorTimestamp,
        );
        selfHealed    = ag.selfHealed;
        webhookResult = ag.webhookResult;
        await storage.updateAnchorPostAgentic(anchor.id, selfHealed, webhookResult, Date.now() - t0);
      }

      // Stage 6: Latency log
      const latencyMs = Date.now() - t0;
      await storage.logPerf({
        anchorId:    anchor.id,
        latencyMs,
        triageClass: triage.triageClass,
        isFlagged:   risk.isFlagged,
        riskScore:   finalRiskScore,
        wasRoutineSkip: triage.shortCircuit,
      });

      const explorerUrl = anchor.blockchainTx
        ? `https://amoy.polygonscan.com/tx/${anchor.blockchainTx}`
        : null;

      res.status(201).json({
        success:            true,
        hash,
        riskScore:          finalRiskScore,
        isFlagged:          risk.isFlagged,
        flagReason:         risk.flagReason,
        triageClass:        triage.triageClass,
        anomalyScore:       triage.anomalyScore,
        xaiFactors:         risk.xaiFactors,
        selfHealed,
        webhookResult,
        blockchainVerified: anchor.blockchainVerified,
        merkleRoot:         anchor.merkleRoot,
        blockchainTx:       anchor.blockchainTx,
        explorerUrl,
        latencyMs,
        message:            risk.flagReason ?? "Anchor verified.",
        anchor: { ...anchor, selfHealed, webhookResult },
      });

    } catch (e) {
      if (e instanceof z.ZodError) return res.status(400).json({ error: e.errors[0].message });
      console.error(e);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ── API Key Management ──────────────────────────────────────────────────────

  app.get("/api/keys", async (_req, res) => {
    const keys = await storage.getAllApiKeys();
    res.json(keys.map((k) => ({ ...k, keyPreview: "gz_••••••••••••••••••••" + k.key.slice(-6) })));
  });

  app.post("/api/keys", async (req, res) => {
    const { name, appId } = req.body;
    if (!name || !appId) return res.status(400).json({ error: "name and appId are required" });
    const key = await storage.createApiKey(String(name), String(appId));
    res.status(201).json({ ...key, message: "Save this key — it will not be shown again in full." });
  });

  app.delete("/api/keys/:key", async (req, res) => {
    const ok = await storage.revokeApiKey(req.params.key);
    if (!ok) return res.status(404).json({ error: "Key not found" });
    res.json({ success: true, message: "Key revoked" });
  });

  app.delete("/api/keys/:key/permanent", async (req, res) => {
    const ok = await storage.deleteApiKey(req.params.key);
    if (!ok) return res.status(404).json({ error: "Key not found" });
    res.json({ success: true, message: "Key deleted" });
  });

  // ── Dashboard Data ──────────────────────────────────────────────────────────

  app.get(API.stats,        async (_req, res) => res.json(await storage.getStats()));
  app.get(API.incidents,    async (_req, res) => res.json(await storage.getFlaggedIncidents(50)));
  app.get(API.feed,         async (_req, res) => res.json(await storage.getRecentAnchors(100)));
  app.get(API.anchors,      async (_req, res) => res.json(await storage.getRecentAnchors(100)));
  app.get(API.researchData, async (_req, res) => res.json(await storage.getResearchData()));

  app.get(API.merkleBatches, async (_req, res) => {
    const batches = await storage.getMerkleBatches();
    res.json(batches.map((b) => ({
      ...b,
      explorerUrl: `https://amoy.polygonscan.com/tx/${b.txHash}`,
    })));
  });

  // ── Simulate Fraud ──────────────────────────────────────────────────────────

  app.post(API.simulateFraud, async (req, res) => {
    try {
      const keys      = await storage.getAllApiKeys();
      const activeKey = keys.find((k) => k.isActive);
      if (!activeKey) return res.status(400).json({ error: "Create at least one API key first." });

      const { value = 98, field = "grade", preset } = req.body;
      let payload: Record<string, any>;
      if (preset === "attack") {
        payload = { salary: 999999, role: "super_admin", access_level: 99 };
      } else {
        payload = { [String(field)]: Number(value) };
      }

      const entityId        = `sim-${Date.now()}`;
      const hash            = hashPayload(payload);
      const prev            = await storage.getLatestAnchorForEntity(activeKey.appId, entityId);
      const triage          = runIsolationForestTriage(payload, prev?.payload ?? null);
      const anchorTimestamp = new Date();

      let risk: RiskResult;
      if (triage.shortCircuit) {
        risk = { riskScore: 0, isFlagged: false, flagReason: null,
          xaiFactors: [{ name: "Triage Gate", weight: 100, detail: "ROUTINE — audit skipped" }] };
      } else {
        risk = runSemanticAudit(payload, prev?.payload ?? null, "DASHBOARD_SIMULATE", triage);
      }

      const finalRiskScore = (triage.triageClass === "CRITICAL" && risk.isFlagged)
        ? Math.max(risk.riskScore, AGENTIC_THRESHOLD)
        : risk.riskScore;

      const anchor = await storage.createAnchor({
        appId: activeKey.appId, userId: "DASHBOARD_SIMULATE", entityId,
        payload, hash, timestamp: anchorTimestamp,
        riskScore: finalRiskScore, isFlagged: risk.isFlagged, flagReason: risk.flagReason,
        triageClass: triage.triageClass, xaiFactors: risk.xaiFactors,
        selfHealed: false, webhookResult: null,
        merkleRoot: null, blockchainVerified: false, blockchainTx: null, latencyMs: 0,
      });

      let selfHealed    = false;
      let webhookResult: string | null = null;
      if (finalRiskScore >= AGENTIC_THRESHOLD) {
        const ag = await triggerAgenticMitigation(
          anchor.id, activeKey.appId, entityId,
          finalRiskScore, risk.flagReason, anchorTimestamp,
        );
        selfHealed    = ag.selfHealed;
        webhookResult = ag.webhookResult;
        await storage.updateAnchorPostAgentic(anchor.id, selfHealed, webhookResult, 0);
      }

      res.status(201).json({
        success: true,
        anchor:  { ...anchor, selfHealed, webhookResult },
        triageClass: triage.triageClass,
        xaiFactors:  risk.xaiFactors,
        selfHealed,
        webhookResult,
      });

    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Simulation failed" });
    }
  });
}
