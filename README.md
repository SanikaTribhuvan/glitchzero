# 🛡️ GlitchZero v6 — AI-Native Trust Infrastructure (PostgreSQL Edition)

> Research-grade audit anchoring system with hybrid anomaly detection,  
> PostgreSQL-backed blockchain verifiability, SHAP-style XAI attribution,  
> and agentic self-healing mitigation.  

Zero-setup · language-agnostic API · SCOPUS-publication-ready metrics.

---

## 🚀 Version 6 Upgrade — Postgres + Neon Architecture

GlitchZero v6 migrates from SQLite to **PostgreSQL (Neon Cloud DB)**  
while preserving the full dashboard UI and research endpoints.

### Key Enhancements

- ✅ Migrated to **PostgreSQL (Neon DB)** using native `pg` driver
- ✅ Node.js 24 optimized runtime (ESM + Top-Level Await)
- ✅ Drizzle ORM with automated schema migrations
- ✅ Merkle Roots stored in `trust_anchors` PostgreSQL table
- ✅ Preserved Dashboard UI (no structural UI changes)
- ✅ Maintains Research Endpoint for SCOPUS paper metrics

---

## ⚡ Quick Start (v6 Production)

### 1. Create `.env`

```env
DATABASE_URL=postgres://[user]:[password]@[host]/neondb?sslmode=require
NODE_ENV=production
PORT=5000
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Push Schema to PostgreSQL

```bash
npm run db:push
```

### 4. Start Server

```bash
npm start
# → http://localhost:5000/dashboard
```

---

# 🧠 Architecture — 5 Advanced Systems

---

## 1️⃣ Hybrid Anomaly Detection (Isolation Forest Triage)

Every incoming anchor is scored using a lightweight 4-feature vector
simulating Isolation Forest / One-Class SVM behavior before expensive audits.

| Feature | Weight | Description |
|----------|--------|------------|
| Absolute magnitude | 45% | Numeric fields > 90 |
| Delta magnitude | 35% | % change vs previous record |
| Sensitive field | 12% | role / permission / access_level |
| Temporal anomaly | 8% | Outside 07:00–19:00 business hours |

### Triage Classification

- **ROUTINE** (< 0.35) → Fast-path (audit skipped)
- **SUSPICIOUS** (0.35–0.70) → Full semantic audit
- **CRITICAL** (≥ 0.70) → Audit + agentic rollback eligible

All metrics are logged into PostgreSQL for longitudinal research analysis.

---

## 2️⃣ Verifiable Trust (Merkle + PostgreSQL Anchoring)

- `shared/schema.ts` → `buildMerkleRoot()`  
  SHA-256 binary Merkle tree (sorted pair concatenation)

- Every 10 anchors:
  - Compute Merkle Root
  - Store in `trust_anchors` table (PostgreSQL)
  - Generate deterministic simulated Polygon tx hash

- Dashboard Blockchain tab shows:
  - Merkle Root
  - Batch size
  - Simulated transaction hash

Each anchor includes:

```
blockchainVerified: true
merkleRoot: <root>
```

Ensuring tamper-evident historical integrity.

---

## 3️⃣ Explainability Metrics (SHAP-Style XAI)

Each anomaly includes normalized feature attribution:

```
Risk Factors:
Absolute Threshold (45%)
Change Magnitude (32%)
Sensitive Field (14%)
Timing (9%)
```

Example:

```
'salary' changed 82% (55000 → 99000) [user: hr_admin]
```

Visible in:
- Incidents Table
- Incident Sidebar
- API Tester Response Panel
- Research Endpoint JSON

All attribution data stored in PostgreSQL for reproducibility.

---

## 4️⃣ Agentic Mitigation (Self-Healing Rollback)

When:

```
riskScore >= 96
```

System automatically:

1. POSTs `GLITCHZERO_AUTO_ROLLBACK` to `/api/internal/rollback`
2. Marks `selfHealed: true`
3. Stores webhook result in PostgreSQL
4. Displays 🛡 SELF-HEALED badge in Dashboard

The API Tester includes a **Simulate Attack** preset to trigger this flow.

---

## 5️⃣ Performance Logging — Research Endpoint

### GET `/api/dashboard/research-data`

Returns structured JSON containing:

- TP / FP / TN / FN
- Precision / Recall / F1 / Accuracy
- avg_ms / p50_ms / p95_ms / p99_ms latency
- Triage distribution
- Audit skip rate
- Blockchain anchoring summary
- Last 50 request logs

Designed for direct insertion into SCOPUS research tables.

---

# 📡 API Reference

---

## POST `/api/anchor` (requires x-api-key)

```json
{
  "app_id": "your-app",
  "user_id": "user_1",
  "entity_id": "record-id",
  "data_payload": { "salary": 55000 },
  "timestamp": "2026-01-01T00:00:00Z"
}
```

### Response Fields

- `riskScore`
- `anomalyScore`
- `isFlagged`
- `flagReason`
- `triageClass`
- `xaiFactors[]`
- `selfHealed`
- `webhookResult`
- `blockchainVerified`
- `merkleRoot`
- `latencyMs`

---

## GET `/api/dashboard/merkle-batches`

Returns all Merkle batch records from PostgreSQL.

---

## GET `/api/dashboard/research-data`

Returns structured metrics for academic publication.

---

# 🛠️ Tech Stack

| Layer | Technology |
|-------|------------|
| Backend | Node.js 24, Express |
| Database | PostgreSQL (Neon Cloud DB) |
| ORM | Drizzle ORM |
| Integrity | SHA-256 Merkle Tree |
| Blockchain | Polygon (Simulated Anchoring) |
| Frontend | Existing Dashboard UI (Unmodified) |

---

# 📄 Research & Publication Context

GlitchZero v6 is developed as part of a **SCOPUS-indexed research initiative**
focusing on AI-Native Trust Infrastructure for distributed institutional systems.

**Author:** Sanika Sameer Tribhuvan  
**Version:** 6.0 (PostgreSQL Edition)
