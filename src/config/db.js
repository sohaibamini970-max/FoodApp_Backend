const { Pool } = require("pg");
require("dotenv").config();

// Prefer DIRECT for local dev — pooled endpoint has been unreliable on this network
// In production, set PREFER_POOLED=true in .env
const usePooled = process.env.PREFER_POOLED === "true";

const connectionString = usePooled
  ? process.env.DATABASE_URL
  : process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL;

console.log(
  `[db] Using ${usePooled ? "POOLED" : "DIRECT"} →`,
  connectionString?.replace(/:[^:@]+@/, ":****@")
);

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 15_000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
});

pool.on("error", (err) =>
  console.error("[db] Pool error (will auto-recover):", err.message)
);

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};