# 🛡️ GlitchZero v6 — AI-Native Trust Infrastructure (Production Deployment)

> Research-grade audit anchoring system with hybrid anomaly detection,  
> PostgreSQL-backed blockchain verifiability, SHAP-style XAI attribution,  
> and agentic self-healing mitigation.  

Zero-setup · language-agnostic API · SCOPUS-publication-ready metrics.

---

# 🌍 Live Production Deployment

GlitchZero v6 is now deployed in production:

**🔗 Public URL:**  
https://glitchzero.onrender.com  

**📊 Live Dashboard:**  
https://glitchzero.onrender.com/dashboard  

### Deployment Architecture

- Hosting Platform: Render (Singapore Region)
- Database: Neon PostgreSQL (Cloud)
- Runtime: Node.js 24
- Environment: Production (NODE_ENV=production)

The system is actively connected to a live PostgreSQL instance with persistent trust anchors.

---

## 🚀 Version 6 — PostgreSQL + Neon Migration

GlitchZero v6 migrated from SQLite to **PostgreSQL (Neon Cloud DB)**  
while preserving the entire dashboard UI and research endpoint structure.

### Key Enhancements

- ✅ Migrated to PostgreSQL using native `pg` driver
- ✅ Node.js 24 optimized runtime (ESM + Top-Level Await)
- ✅ Drizzle ORM for type-safe schema management
- ✅ Merkle Roots stored in `trust_anchors` PostgreSQL table
- ✅ Production-ready cloud deployment
- ✅ Research endpoint retained for SCOPUS publication metrics

---

## ⚡ Local Development Setup

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

Each incoming anchor is scored using a lightweight 4-feature vector
simulating Isolation Forest / One-Class SVM behavior.

| Feature | Weight | Description |
|----------|--------|------------|
| Absolute magnitude | 45% | Numeric fields > threshold |
| Delta magnitude | 35% | % change vs previous record |
| Sensitive field | 12% | role / permission / access_level |
| Temporal anomaly | 8% | Outside 07:00–19:00 business hours |

### Triage Classification

- **ROUTINE** (< 0.35) → Fast-path (audit skipped)
- **SUSPICIOUS** (0.35–0.70) → Full semantic audit
- **CRITICAL** (≥ 0.70) → Audit + agentic rollback eligible

All classifications are logged in PostgreSQL for longitudinal analysis.

---

## 2️⃣ Verifiable Trust (Merkle + PostgreSQL Anchoring)

- `buildMerkleRoot()` implements SHA-256 binary Merkle tree
- Sorted-pair concatenation ensures deterministic hashing
- Every 10 anchors:
  - Compute Merkle Root
  - Store in `trust_anchors` table
  - Generate deterministic simulated Polygon tx hash

Each anchor includes:

```
blockchainVerified: true
merkleRoot: <root>
```

This ensures tamper-evident audit history.

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

All attribution data is persisted in PostgreSQL.

---

## 4️⃣ Agentic Mitigation (Self-Healing Rollback)

When:

```
riskScore >= 96
```

System automatically:

1. Sends `GLITCHZERO_AUTO_ROLLBACK` event
2. Marks `selfHealed: true`
3. Stores webhook result in PostgreSQL
4. Displays 🛡 SELF-HEALED badge in dashboard

The API Tester includes a **Simulate Attack** preset to trigger this flow.

---

## 5️⃣ Performance Logging — Research Endpoint

### GET `/api/dashboard/research-data`

Returns structured JSON:

- TP / FP / TN / FN
- Precision / Recall / F1 / Accuracy
- avg_ms / p50_ms / p95_ms / p99_ms
- Triage distribution
- Audit skip rate
- Blockchain anchoring summary
- Last 50 request logs

Designed for direct insertion into SCOPUS research tables.

---

# 📡 API Reference

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

- riskScore
- anomalyScore
- isFlagged
- flagReason
- triageClass
- xaiFactors[]
- selfHealed
- webhookResult
- blockchainVerified
- merkleRoot
- latencyMs

---

## GET `/api/dashboard/merkle-batches`

Returns Merkle batch records from PostgreSQL.

---

## GET `/api/dashboard/research-data`

Returns publication-ready metrics.

---

# 🛠️ Tech Stack

| Layer | Technology |
|-------|------------|
| Backend | Node.js 24, Express |
| Database | PostgreSQL (Neon Cloud DB) |
| ORM | Drizzle ORM |
| Integrity | SHA-256 Merkle Tree |
| Blockchain | Polygon (Simulated Anchoring) |
| Hosting | Render (Singapore Region) |
| Frontend | Existing Dashboard UI (Unmodified) |

---

# 📄 Research Context

GlitchZero v6 is deployed as a live experimental trust infrastructure
for AI-integrated distributed systems.

The public deployment enables:

- Real-world experimental validation
- Public reviewer access
- Cloud-scale database integrity testing
- Live anomaly detection demonstration

**Author:** Sanika Sameer Tribhuvan  
**Version:** 6.0 — Production (PostgreSQL Edition)
