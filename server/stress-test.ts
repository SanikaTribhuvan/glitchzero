// server/stress-test.ts
// ═══════════════════════════════════════════════════════════════════════════
//  GlitchZero v6 — Live Stress Test Generator (PostgreSQL edition)
//
//  Generates 100 realistic, mixed-risk anchor events so the dashboard,
//  Research Tab, and XAI graphs are immediately populated for demos.
//
//  Usage:
//    npm run stress-test
//
//  Start the server first in a separate terminal:
//    npm run dev
//
//  The script POSTs to the running GlitchZero server; it does not touch
//  Postgres directly. This means it works identically regardless of
//  whether you are using SQLite (v5) or PostgreSQL (v6).
//
//  Distribution (mirrors real-world attendance-system traffic):
//    ~65% ROUTINE    — normal attendance marks, no anomalies
//    ~20% SUSPICIOUS — moderate changes or sensitive fields
//    ~15% CRITICAL   — high-risk mutations, triggers agentic rollback
// ═══════════════════════════════════════════════════════════════════════════

import "dotenv/config";

const BASE_URL = process.env.STRESS_TARGET ?? `http://localhost:${process.env.PORT ?? 5000}`;
const TOTAL    = 100;
const DELAY_MS = 80;  // ms between requests — don't hammer your DB pool

// ── Helpers ───────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function rand(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ── Realistic student / employee entity IDs ───────────────────────────────
const STUDENT_IDS = Array.from({ length: 30 }, (_, i) => `CASAS-TY-${String(i + 1).padStart(3, "0")}`);
const TEACHER_IDS = ["PROF-001", "PROF-002", "PROF-003", "HOD-001"];
const SUBJECTS    = ["DSA", "OS", "DBMS", "CN", "SE", "AI", "ML"];

// ── Event generators ──────────────────────────────────────────────────────

function routineAttendance() {
  return {
    app_id:       "casas-attendance",
    user_id:      pick(TEACHER_IDS),
    entity_id:    pick(STUDENT_IDS),
    data_payload: {
      subject:           pick(SUBJECTS),
      attendance_pct:    rand(60, 88),
      classes_held:      rand(30, 50),
      classes_attended:  rand(20, 45),
      semester:          6,
    },
    timestamp: new Date().toISOString(),
  };
}

function suspiciousEdit() {
  return {
    app_id:       "casas-attendance",
    user_id:      pick(TEACHER_IDS),
    entity_id:    pick(STUDENT_IDS),
    data_payload: {
      subject:          pick(SUBJECTS),
      attendance_pct:   rand(55, 74),
      override_reason:  "Medical leave",
      is_override:      true,
      // Large delta: was 45%, now 72% — triggers Change Magnitude in XAI
      previous_pct:     rand(30, 44),
    },
    timestamp: new Date().toISOString(),
  };
}

function criticalMutation(type: "grade_inflate" | "role_change" | "bulk_override") {
  const entityId = pick(STUDENT_IDS);

  if (type === "grade_inflate") {
    return {
      app_id:       "casas-attendance",
      user_id:      "UNKNOWN-USER",
      entity_id:    entityId,
      data_payload: {
        subject:        pick(SUBJECTS),
        marks_obtained: rand(92, 100),    // > 90 → Absolute Threshold fires
        max_marks:      100,
        grade:          "O",
        attendance_pct: 95,
      },
      timestamp: new Date().toISOString(),
    };
  }

  if (type === "role_change") {
    return {
      app_id:       "casas-hr",
      user_id:      "SYSTEM-SYNC",
      entity_id:    pick(TEACHER_IDS),
      data_payload: {
        designation:  "super_admin",      // SENSITIVE KEY → Designation factor fires
        role:         "HOD",
        access_level: 99,                 // > 90 → Absolute Threshold fires
        department:   "CASAS",
      },
      timestamp: new Date().toISOString(),
    };
  }

  // bulk_override
  return {
    app_id:       "casas-attendance",
    user_id:      "HOD-001",
    entity_id:    entityId,
    data_payload: {
      subject:               pick(SUBJECTS),
      bulk_override_count:   rand(15, 25),
      overridden_students:   rand(15, 25),
      attendance_pct_before: rand(30, 50),
      attendance_pct_after:  rand(75, 95), // > 90 in some cases
      admin:                 true,          // SENSITIVE KEY
    },
    timestamp: new Date().toISOString(),
  };
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🔥  GlitchZero v6 — Stress Test (PostgreSQL)`);
  console.log(`   Waiting for server at ${BASE_URL} …\n`);

  // 1. Health-check: fetch existing keys
  const keysRes = await fetch(`${BASE_URL}/api/keys`).catch(() => null);
  if (!keysRes || !keysRes.ok) {
    console.error("❌  Could not reach GlitchZero. Is `npm run dev` running?");
    process.exit(1);
  }

  // 2. Create a dedicated stress-test key so we don't reuse a user's key
  const createRes = await fetch(`${BASE_URL}/api/keys`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ name: "Stress Test Key (v6)", appId: "stress-test" }),
  });
  const newKey = (await createRes.json()) as any;
  const apiKey: string = newKey.key;

  if (!apiKey) {
    console.error("❌  Failed to create stress-test API key:", newKey);
    process.exit(1);
  }

  console.log(`   Target: ${BASE_URL}`);
  console.log(`   Events: ${TOTAL}`);
  console.log(`   Key:    gz_••••…${apiKey.slice(-6)}\n`);

  let success = 0, failed = 0;
  const counts = { ROUTINE: 0, SUSPICIOUS: 0, CRITICAL: 0 } as Record<string, number>;

  for (let i = 1; i <= TOTAL; i++) {
    // Distribution: 65% routine, 20% suspicious, 15% critical
    const roll = Math.random();
    let payload: any;

    if (roll < 0.65) {
      payload = routineAttendance();
    } else if (roll < 0.85) {
      payload = suspiciousEdit();
    } else {
      payload = criticalMutation(pick(["grade_inflate", "role_change", "bulk_override"]));
    }

    try {
      const res = await fetch(`${BASE_URL}/api/anchor`, {
        method:  "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey },
        body:    JSON.stringify(payload),
      });

      if (res.ok) {
        const data = (await res.json()) as any;
        const actual = data.triageClass ?? "ROUTINE";
        counts[actual] = (counts[actual] ?? 0) + 1;

        const flag   = data.isFlagged  ? "⚠ FLAGGED" : "✓";
        const healed = data.selfHealed ? " 🛡 HEALED" : "";
        const bc     = data.blockchainVerified ? " ⛓" : "";
        console.log(
          `  [${String(i).padStart(3)}] ${actual.padEnd(10)} | ` +
          `risk: ${String(data.riskScore ?? 0).padStart(3)}% | ${flag}${healed}${bc}`
        );
        success++;
      } else {
        const err = await res.text();
        console.error(`  [${i}] ❌ HTTP ${res.status}: ${err}`);
        failed++;
      }
    } catch (err: any) {
      console.error(`  [${i}] ❌ Network error: ${err?.message}`);
      failed++;
    }

    await sleep(DELAY_MS);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${"═".repeat(54)}`);
  console.log(`  ✅  GlitchZero v6 Stress Test Complete`);
  console.log(`  DB:      PostgreSQL (${(process.env.DATABASE_URL ?? "").replace(/:\/\/[^@]*@/, "://***@").slice(0, 50)}…)`);
  console.log(`  Success: ${success}  |  Failed: ${failed}`);
  console.log(`\n  Triage distribution:`);
  console.log(`    ROUTINE:    ${counts.ROUTINE ?? 0}`);
  console.log(`    SUSPICIOUS: ${counts.SUSPICIOUS ?? 0}`);
  console.log(`    CRITICAL:   ${counts.CRITICAL ?? 0}`);
  console.log(`\n  📊  Open ${BASE_URL}/dashboard → Research tab`);
  console.log(`${"═".repeat(54)}\n`);

  // Cleanup: delete the temporary stress-test key
  await fetch(`${BASE_URL}/api/keys/${apiKey}/permanent`, { method: "DELETE" });
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
