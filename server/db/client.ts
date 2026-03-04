// server/db/client.ts
// Creates and exports the single Drizzle + node-postgres (pg) connection pool.
// Pure JavaScript driver — zero native binaries, works on Node 24 / Render / Railway.
// Connection string is read from DATABASE_URL in .env.

import "dotenv/config";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "DATABASE_URL environment variable is not set.\n" +
    "Set it in .env to your Neon / Supabase / Railway Postgres connection string."
  );
}

// Detect local vs. cloud: disable SSL certificate verification for localhost
// (Neon / Supabase require SSL but use self-signed certs → rejectUnauthorized: false)
const isLocal = connectionString.includes("localhost") || connectionString.includes("127.0.0.1");

export const pool = new Pool({
  connectionString,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  max:                   10,    // max simultaneous connections
  idleTimeoutMillis:     30_000,
  connectionTimeoutMillis: 5_000,
});

// Log connection errors rather than crashing hard (pool auto-reconnects)
pool.on("error", (err) => {
  console.error("  ❌  Postgres pool error:", err.message);
});

export const db = drizzle(pool, { schema });
