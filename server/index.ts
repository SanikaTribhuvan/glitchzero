// server/index.ts — GlitchZero v5 Production Entry Point
import "dotenv/config";
import express   from "express";
import cors      from "cors";
import path, { dirname } from "path";
import { fileURLToPath } from "url";
import { registerRoutes } from "./routes.js";
import { seedDatabase }   from "./storage.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

// ── CORS ─────────────────────────────────────────────────────────────────
// Reads ALLOWED_ORIGINS from .env (comma-separated).
// Allows your React Attendance System to call this API without browser blocks.
const rawOrigins = process.env.ALLOWED_ORIGINS ?? "http://localhost:5173,http://localhost:3000";
const allowedOrigins = rawOrigins.split(",").map(o => o.trim()).filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (curl, Postman, server-to-server)
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
      return cb(null, true);
    }
    console.warn(`  ⛔  CORS blocked: ${origin}`);
    cb(new Error(`Origin ${origin} not allowed by CORS policy`));
  },
  methods:     ["GET", "POST", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-api-key", "x-gz-sig"],
  credentials: true,
}));

app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));

// ── Request logger ────────────────────────────────────────────────────────
app.use((req, _res, next) => {
  if (req.path.startsWith("/api")) {
    console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.path}`);
  }
  next();
});

// ── Boot ──────────────────────────────────────────────────────────────────
(async () => {
  await seedDatabase();
  registerRoutes(app);

  // Dashboard SPA
  app.get("/dashboard", (_req, res) =>
    res.sendFile(path.resolve(__dirname, "..", "dashboard", "index.html"))
  );

  // Marketing site + catch-all
  app.use("/", express.static(path.resolve(__dirname, "..", "marketing_site")));
  app.get("*", (_req, res) =>
    res.sendFile(path.resolve(__dirname, "..", "marketing_site", "index.html"))
  );

  const port = Number(process.env.PORT ?? 5000);
  app.listen(port, "0.0.0.0", () => {
    console.log(`\n🚀  GlitchZero v5 Production running!\n`);
    console.log(`   🌐  http://localhost:${port}/`);
    console.log(`   📊  http://localhost:${port}/dashboard`);
    console.log(`   🔒  CORS origins: ${allowedOrigins.join(", ")}`);
    console.log(`   🔄  Rollback URL: ${process.env.ROLLBACK_URL || "(internal echo — set ROLLBACK_URL in .env)"}\n`);
  });
})();
